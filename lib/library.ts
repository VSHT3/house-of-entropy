// The Library of Babel page engine — a true reversible bijection between a page's
// coordinate and its 3200-character text, using BigInt.
//
// A page is L = 80*40 = 3200 characters over a 25-symbol alphabet. There are 25^L
// possible pages. We map each page <-> an integer in [0, 25^L) via base-25 encoding,
// then pass that integer through an invertible affine cipher (mod 25^L) so that
// adjacent coordinates don't produce near-identical pages. Everything is reversible,
// so text -> coordinate search works exactly.

import { ALPHABET, CHARS_PER_LINE, LINES_PER_PAGE } from "./babel";
import { WORDS, SEPARATORS } from "./words";

export const PAGE_LEN = CHARS_PER_LINE * LINES_PER_PAGE; // 3200
const BASE = BigInt(ALPHABET.length); // 25n
const MOD = BASE ** BigInt(PAGE_LEN); // 25^3200, the size of page-space

// Affine cipher x -> (A*x + C) mod MOD. A must be coprime with MOD (=25^L) i.e. not a
// multiple of 5. A small A would leave small addresses near-zero (pages of all 'a'), so we
// build a FULL-WIDTH multiplier: a ~4400-digit constant that spreads even tiny addresses
// across the whole page. Deterministic, fixed, and coprime to 25.
function buildWideMultiplier(): bigint {
  // Fill all PAGE_LEN base-25 digits from a simple LCG, then force coprimality with 25.
  let x = 88172645463325252n; // arbitrary fixed seed
  const MASK64 = (1n << 64n) - 1n;
  let a = 0n;
  for (let i = 0; i < PAGE_LEN; i++) {
    x ^= (x << 13n) & MASK64;
    x ^= x >> 7n;
    x ^= (x << 17n) & MASK64; // xorshift64
    const digit = ((x % BASE) + BASE) % BASE;
    a = a * BASE + digit;
  }
  if (a % 5n === 0n) a += 1n; // ensure gcd(a,25)=1
  return a % MOD;
}
const A = buildWideMultiplier();
const C = 1442695040888963407n;

// Modular inverse of A mod MOD via extended Euclid (BigInt).
function modInverse(a: bigint, mod: bigint): bigint {
  let [old_r, r] = [((a % mod) + mod) % mod, mod];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  // old_r should be 1 (gcd); old_s is the inverse
  return ((old_s % mod) + mod) % mod;
}
const A_INV = modInverse(A, MOD);

// --- coordinate <-> page index ---------------------------------------------

export type PageCoord = {
  q: number; // hex axial
  r: number;
  wall: number; // 0..5 (shelf walls only carry books)
  shelf: number; // 0..4
  book: number; // 0..31
  page: number; // 0..409
};

// Pack a coordinate into a single BigInt "address". This address is then ciphered to
// produce the page-space index, so structurally-near books look unrelated.
import {
  SHELVES_PER_WALL,
  BOOKS_PER_SHELF,
  PAGES_PER_BOOK,
} from "./babel";

// zig-zag map signed int <-> unsigned (so negative q,r encode cleanly)
const zig = (n: number): bigint => (n >= 0 ? BigInt(2 * n) : BigInt(-2 * n - 1));
const zigB = (n: bigint): bigint => (n >= 0n ? 2n * n : -2n * n - 1n);
const unzig = (b: bigint): number => (b % 2n === 0n ? Number(b / 2n) : -Number((b + 1n) / 2n));
const unzigB = (b: bigint): bigint => (b % 2n === 0n ? b / 2n : -(b + 1n) / 2n);

// radix of the bounded part of a coordinate (page,book,shelf,wall)
const RADIX = BigInt(PAGES_PER_BOOK * BOOKS_PER_SHELF * SHELVES_PER_WALL * 6);

// Cantor pairing <-> two unsigned ints
function cantor(a: bigint, b: bigint): bigint {
  return ((a + b) * (a + b + 1n)) / 2n + b;
}
function uncantor(z: bigint): [bigint, bigint] {
  // w = floor((sqrt(8z+1)-1)/2)
  let w = bigintSqrt(8n * z + 1n);
  w = (w - 1n) / 2n;
  const t = (w * w + w) / 2n;
  const b = z - t;
  const a = w - b;
  return [a, b];
}
function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("neg");
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export function coordToAddress(c: PageCoord): bigint {
  // bounded part: mixed-radix pack of page, book, shelf, wall
  let mixed = 0n;
  mixed = mixed * BigInt(PAGES_PER_BOOK) + BigInt(c.page);
  mixed = mixed * BigInt(BOOKS_PER_SHELF) + BigInt(c.book);
  mixed = mixed * BigInt(SHELVES_PER_WALL) + BigInt(c.shelf);
  mixed = mixed * 6n + BigInt(c.wall);
  // unbounded part: pair the two zig-zagged hex coords
  const paired = cantor(zig(c.q), zig(c.r));
  return paired * RADIX + mixed;
}

// BigInt-coord variant: q,r may be astronomically large (floating origin).
export type PageCoordBig = { q: bigint; r: bigint; wall: number; shelf: number; book: number; page: number };

export function coordToAddressBig(c: PageCoordBig): bigint {
  let mixed = 0n;
  mixed = mixed * BigInt(PAGES_PER_BOOK) + BigInt(c.page);
  mixed = mixed * BigInt(BOOKS_PER_SHELF) + BigInt(c.book);
  mixed = mixed * BigInt(SHELVES_PER_WALL) + BigInt(c.shelf);
  mixed = mixed * 6n + BigInt(c.wall);
  const paired = cantor(zigB(c.q), zigB(c.r));
  return paired * RADIX + mixed;
}

// Page text for a (possibly huge) BigInt coordinate.
export function pageTextBig(c: PageCoordBig): string {
  const addr = coordToAddressBig(c);
  const index = (A * (((addr % MOD) + MOD) % MOD) + C) % MOD;
  return indexToText(index);
}

export function addressToCoord(addr: bigint): PageCoord {
  const a = ((addr % MOD) + MOD) % MOD;
  let mixed = a % RADIX;
  const paired = a / RADIX;
  const wall = Number(mixed % 6n);
  mixed /= 6n;
  const shelf = Number(mixed % BigInt(SHELVES_PER_WALL));
  mixed /= BigInt(SHELVES_PER_WALL);
  const book = Number(mixed % BigInt(BOOKS_PER_SHELF));
  mixed /= BigInt(BOOKS_PER_SHELF);
  const page = Number(mixed % BigInt(PAGES_PER_BOOK));
  const [zq, zr] = uncantor(paired);
  return { q: unzig(zq), r: unzig(zr), wall, shelf, book, page };
}

// --- index <-> text ---------------------------------------------------------

function indexToText(index: bigint): string {
  let n = ((index % MOD) + MOD) % MOD;
  const out = new Array<string>(PAGE_LEN);
  for (let i = PAGE_LEN - 1; i >= 0; i--) {
    const d = Number(n % BASE);
    out[i] = ALPHABET[d];
    n = n / BASE;
  }
  return out.join("");
}

function textToIndex(text: string): bigint {
  let n = 0n;
  for (let i = 0; i < text.length; i++) {
    const d = ALPHABET.indexOf(text[i]);
    n = n * BASE + BigInt(d < 0 ? 0 : d);
  }
  return n;
}

// --- public: page generation + reverse search -------------------------------

// Coordinate -> the 3200-char page text (deterministic, reversible).
export function pageText(c: PageCoord): string {
  const addr = coordToAddress(c);
  const index = (A * (addr % MOD) + C) % MOD; // affine scramble
  return indexToText(index);
}

// Normalise arbitrary user input to the alphabet (lowercase; drop unsupported chars).
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .filter((ch) => ALPHABET.indexOf(ch) >= 0)
    .join("")
    .slice(0, PAGE_LEN);
}

export type SearchResult = {
  text: string; // the full 3200-char page that contains the query
  offset: number; // char index where the query starts (first stamped char)
  spans: number[]; // every raw char index occupied by the query (for exact highlighting)
  query: string; // the normalised query
  addrHex: string; // the page address as a hex string (the "where" — usually astronomically large)
};

// Hash a normalised query into a nonzero 64-bit LCG seed (FNV-1a, then salted per mode).
// Same query → same seed → same background, but distinct queries diverge. `salt` keeps the
// noise and word modes visually distinct for an identical query.
function seedFrom(query: string, salt: bigint): bigint {
  const M64 = (1n << 64n) - 1n;
  let h = (0xcbf29ce484222325n ^ salt) & M64;
  for (let i = 0; i < query.length; i++) {
    h = ((h ^ BigInt(query.charCodeAt(i))) * 0x100000001b3n) & M64;
  }
  return h === 0n ? 1n : h;
}

// "Contains" search: build a page that CONTAINS the query embedded in (space) noise at a
// deterministic offset, then invert to the address that produces exactly that page.
// There are infinitely many containing pages; we return one deterministic instance.
// We return the page TEXT directly (the address is typically far too large to express as a
// small q,r coordinate; rendering from text avoids any Number overflow).
// Word-wrap a normalised query into lines of at most `width` chars (breaks long words).
function wrapToLines(query: string, width: number): string[] {
  const words = query.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (w.length > width) {
      // hard-break a word longer than a line
      if (cur) { lines.push(cur); cur = ""; }
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      continue;
    }
    const next = cur ? cur + " " + w : w;
    if (next.length > width) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// The open-book spread only renders the first VISIBLE_LINES of the 80-char page (the rest of
// the page falls below the two visible half-pages). Keep the query block inside that window so
// every search lands somewhere the reader can actually see and highlight. Must stay in sync
// with OpenBook's PAGE_ROWS * 2 * PAGE_COLS / CHARS_PER_LINE (= 60 * 40 / 80 = 30).
const VISIBLE_LINES = 30;

// Lay the query in as clean word-wrapped lines at a query-derived start line, then turn the
// finished page into its (reversible) address. The `chars` array must already be filled with
// the chosen background (noise or words).
function finishPage(chars: string[], query: string, seed: bigint): SearchResult {
  const wrapped = wrapToLines(query, CHARS_PER_LINE);
  // Place the block at a query-derived line so different searches land at different spots,
  // while staying deterministic. Clamp so the whole wrapped block fits in the VISIBLE window.
  const maxStart = Math.max(0, VISIBLE_LINES - wrapped.length);
  const startLine = maxStart === 0 ? 0 : Number(seed % BigInt(maxStart + 1));
  const spans: number[] = [];
  for (let li = 0; li < wrapped.length && startLine + li < LINES_PER_PAGE; li++) {
    const base = (startLine + li) * CHARS_PER_LINE;
    const ln = wrapped[li];
    for (let c = 0; c < ln.length; c++) {
      chars[base + c] = ln[c];
      spans.push(base + c);
    }
  }
  const text = chars.join("");
  const index = textToIndex(text);
  const addr = (A_INV * (((index - C) % MOD) + MOD)) % MOD;
  return { text, offset: startLine * CHARS_PER_LINE, spans, query, addrHex: addr.toString(16) };
}

// Background = pure deterministic noise (the classic Babel look).
export function containsSearch(raw: string): SearchResult | null {
  const query = normalizeQuery(raw);
  if (query.length === 0) return null;
  const chars = new Array<string>(PAGE_LEN);
  const seed = seedFrom(query, 0x9e3779b9n);
  let x = seed;
  for (let i = 0; i < PAGE_LEN; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    chars[i] = ALPHABET[Number((x >> 33n) % BASE)];
  }
  return finishPage(chars, query, seed);
}

// Background = plausible English words separated by spaces/punctuation.
export function containsSearchWords(raw: string): SearchResult | null {
  const query = normalizeQuery(raw);
  if (query.length === 0) return null;
  const chars = new Array<string>(PAGE_LEN).fill(" ");
  const seed = seedFrom(query, 0xc2b2ae3dn);
  let x = seed;
  const rnd = () => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(x >> 33n);
  };
  let pos = 0;
  while (pos < PAGE_LEN) {
    const w = WORDS[rnd() % WORDS.length];
    const sep = SEPARATORS[rnd() % SEPARATORS.length];
    const chunk = w + sep;
    for (let c = 0; c < chunk.length && pos < PAGE_LEN; c++, pos++) {
      const ch = chunk[c];
      chars[pos] = ALPHABET.indexOf(ch) >= 0 ? ch : " ";
    }
  }
  return finishPage(chars, query, seed);
}

// Recover the full BigInt coordinate (true q,r, possibly enormous) from an address hex.
export function addrHexToCoordBig(hex: string): PageCoordBig {
  const addr = ((BigInt("0x" + hex) % MOD) + MOD) % MOD;
  let mixed = addr % RADIX;
  const paired = addr / RADIX;
  const wall = Number(mixed % 6n);
  mixed /= 6n;
  const shelf = Number(mixed % BigInt(SHELVES_PER_WALL));
  mixed /= BigInt(SHELVES_PER_WALL);
  const book = Number(mixed % BigInt(BOOKS_PER_SHELF));
  mixed /= BigInt(BOOKS_PER_SHELF);
  const page = Number(mixed % BigInt(PAGES_PER_BOOK));
  const [zq, zr] = uncantor(paired);
  return { q: unzigB(zq), r: unzigB(zr), wall, shelf, book, page };
}

// Go to a raw address (hex string, with or without 0x): regenerate its page text.
export function pageFromAddrHex(hex: string): SearchResult | null {
  const clean = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(clean)) return null;
  const addr = BigInt("0x" + clean) % MOD;
  const index = (A * addr + C) % MOD;
  return { text: indexToText(index), offset: -1, spans: [], query: "", addrHex: addr.toString(16) };
}

// The full coordinate of a search result, as a display string. The address is usually far
// too large for small q,r, so we express it in two readable forms.
export function addrToCoordString(addrHex: string): string {
  const addr = BigInt("0x" + addrHex);
  // bounded part is exact and small; the hex location is the (huge) paired part
  let mixed = addr % RADIX;
  const paired = addr / RADIX;
  const wall = Number(mixed % 6n);
  mixed /= 6n;
  const shelf = Number(mixed % BigInt(SHELVES_PER_WALL));
  mixed /= BigInt(SHELVES_PER_WALL);
  const book = Number(mixed % BigInt(BOOKS_PER_SHELF));
  mixed /= BigInt(BOOKS_PER_SHELF);
  const page = Number(mixed % BigInt(PAGES_PER_BOOK));
  // the hex index is astronomically large — show a short head…tail so the rest stays readable
  const h = paired.toString(36);
  const hexShort = h.length > 14 ? `${h.slice(0, 7)}…${h.slice(-5)}` : h;
  return `hex ${hexShort} · wall ${wall} · shelf ${shelf} · book ${book} · page ${page + 1}`;
}

// --- the tutorial book ------------------------------------------------------
// A specific, naturally-occurring coordinate in the spawn hex (1,0), on a solid shelf
// wall (1), middle shelf, middle book. It is highlighted in the shelf and shows custom
// guidance text instead of the generated page, so newcomers have a way in.
export const TUTORIAL_COORD: Omit<PageCoord, "page"> = {
  q: 1,
  r: 0,
  wall: 1,
  shelf: 2,
  book: 16,
};

// Accepts BigInt q,r (the floating-origin true coord). The tutorial book lives at the
// initial-origin spawn hex (1,0); after rebasing, no book matches (origin moved away).
export function isTutorialBook(c: { q: bigint; r: bigint; wall: number; shelf: number; book: number }): boolean {
  return (
    c.q === BigInt(TUTORIAL_COORD.q) &&
    c.r === BigInt(TUTORIAL_COORD.r) &&
    c.wall === TUTORIAL_COORD.wall &&
    c.shelf === TUTORIAL_COORD.shelf &&
    c.book === TUTORIAL_COORD.book
  );
}

const TUTORIAL_LEFT = [
  "      THE HOUSE OF ENTROPY",
  "",
  "  You stand inside the Library",
  "  of Babel. Every wall holds",
  "  books; every book is one of",
  "  all possible books.",
  "",
  "  Nothing here is stored. Each",
  "  page is computed from its",
  "  location the instant you open",
  "  it. The same shelf always",
  "  holds the same words.",
].join("\n");

const TUTORIAL_RIGHT = [
  "        HOW TO WANDER",
  "",
  "  WASD ......... walk",
  "  mouse ........ look",
  "  click a book . read it",
  "  arrows ....... turn pages",
  "  esc .......... close / release",
  "",
  "  Walk through any doorway to",
  "  the next hexagon. The halls",
  "  go on without end.",
  "",
  "  Almost every page is noise.",
  "  Somewhere, all meaning waits.",
].join("\n");

export function tutorialPages(): { left: string; right: string } {
  return { left: TUTORIAL_LEFT, right: TUTORIAL_RIGHT };
}

// Split a page string into its lines for rendering.
export function pageLines(text: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < LINES_PER_PAGE; i++) {
    lines.push(text.slice(i * CHARS_PER_LINE, (i + 1) * CHARS_PER_LINE));
  }
  return lines;
}
