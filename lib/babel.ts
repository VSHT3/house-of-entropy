// Borges "Library of Babel" constants — faithful to the 1941 story.

// Borges' faithful alphabet is 22 letters + space + comma + period (25). We add the full
// a-z plus a few punctuation marks so search input is typeable. ALPHABET is the single
// source of truth for the page engine (BASE = ALPHABET.length); everything follows from it.
export const ALPHABET = "abcdefghijklmnopqrstuvwxyz" + " ,.?!-;:'"; // 26 + 9 = 35 chars
export const CHARS_PER_LINE = 80;
export const LINES_PER_PAGE = 40;
export const PAGES_PER_BOOK = 410;
export const BOOKS_PER_SHELF = 32;
export const SHELVES_PER_WALL = 7;
export const WALLS_PER_HEX = 4; // 6 walls total; 2 are doorways, 4 hold shelves
export const BOOKS_PER_HEX = BOOKS_PER_SHELF * SHELVES_PER_WALL * WALLS_PER_HEX;

export const CHARS_PER_BOOK = CHARS_PER_LINE * LINES_PER_PAGE * PAGES_PER_BOOK; // 1,312,000

// --- Hexagon room geometry (world units = metres) ---
export const HEX_RADIUS = 4.5; // centre to vertex
export const WALL_HEIGHT = 4.0;
export const DOORWAY_WIDTH = 1.6;
export const DOORWAY_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.3;

// --- Hex grid (axial coords q,r) ---
// Center-to-center distance for edge-sharing hexes.
export const HEX_STEP = HEX_RADIUS * Math.sqrt(3);

// Axial basis vectors = the world offsets to the wall-0 and wall-1 neighbours.
// (Derived from the actual wall midpoints so geometry lines up exactly; see lib tests.)
const _v = hexVertices();
function _wallMid(i: number): [number, number] {
  const [x1, z1] = _v[i];
  const [x2, z2] = _v[(i + 1) % 6];
  return [(x1 + x2) / 2, (z1 + z2) / 2];
}
const B0 = _wallMid(0).map((c) => c * 2) as [number, number]; // neighbour offset across wall 0
const B1 = _wallMid(1).map((c) => c * 2) as [number, number]; // neighbour offset across wall 1

// World (x,z) center of hex (q,r).
export function hexToWorld(q: number, r: number): [number, number] {
  return [q * B0[0] + r * B1[0], q * B0[1] + r * B1[1]];
}

// Nearest hex (q,r) to a world (x,z) — invert the axial basis, round in cube space.
// Inverse of hexToWorld. Used to derive the local hex the player stands in (HexGrid culling,
// and the multiplayer send-side to compute the true coord + intra-hex offset).
export function worldToHex(x: number, z: number): [number, number] {
  // basis from hexToWorld: solve [B0 B1] * [q r]^T = [x z]^T
  const [b0x, b0z] = hexToWorld(1, 0);
  const [b1x, b1z] = hexToWorld(0, 1);
  const det = b0x * b1z - b1x * b0z;
  const qf = (x * b1z - z * b1x) / det;
  const rf = (b0x * z - b0z * x) / det;
  // cube rounding for hex grids
  const sf = -qf - rf;
  let rq = Math.round(qf), rr = Math.round(rf);
  const rs = Math.round(sf);
  const dq = Math.abs(rq - qf), dr = Math.abs(rr - rf), ds = Math.abs(rs - sf);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

// --- Infinite straight corridor -------------------------------------------------------
// The flower tiling hides perfectly straight world lines that thread an unbounded chain of
// door midpoints (alternating wall-0 / wall-1 doors of adjacent ring hexes). They run along
// the world +z/-z axis, spaced HEX_STEP*1.5 apart, centred on odd multiples of HEX_STEP*0.75.
// Stand on one and walk due north/south and you never meet a wall. (Brute-force verified: a
// vertical line at x = ±5.846, ±17.54 ... hits 24+ consecutive door mids, lateral offset 0.)
export const CORRIDOR_SPACING = HEX_STEP * 1.5;   // x-distance between adjacent corridors
export const CORRIDOR_HALF = HEX_STEP * 0.75;     // first corridor offset from x=0

// Snap a world x to the nearest corridor line (x = CORRIDOR_HALF * odd integer).
export function nearestCorridorX(x: number): number {
  // corridor x = CORRIDOR_SPACING*n + CORRIDOR_HALF, n integer
  const n = Math.round((x - CORRIDOR_HALF) / CORRIDOR_SPACING);
  return CORRIDOR_SPACING * n + CORRIDOR_HALF;
}

// --- Door-midpoint travel polyline ----------------------------------------------------
// Walk the maze door-to-door producing a smooth corridor path for the search flythrough.
// At each hex we leave through the door whose outward direction best matches our heading;
// the heading then snaps to that door's direction, which is what bends the route into
// gentle 60° turns. Every segment is one hex-step long (constant ~6.75m). The path is in
// *local* render space (small floats), used purely for the camera animation — the real
// destination is handled by the floating-origin rebase elsewhere.
function _doorsLocal(q: number, r: number): number[] {
  const out: number[] = [];
  for (let w = 0; w < 6; w++) if (isDoor(q, r, w)) out.push(w);
  return out;
}
function _doorMidWorld(q: number, r: number, w: number): [number, number] {
  const [cx, cz] = hexToWorld(q, r);
  const [mx, mz] = _wallMid(w);
  return [cx + mx, cz + mz];
}

export type TravelPath = { pts: [number, number][] };

// startQ/startR: local hex to depart from. heading: initial desired travel dir (x,z).
// turn: 0 = dead straight (stay on one corridor); >0 lets the route wander/turn — every
// `turn` steps the heading is rotated ±60° so the route changes corridor and takes a bend.
export function buildTravelPath(
  startQ: number,
  startR: number,
  heading: [number, number],
  steps: number,
  turn = 1,
): TravelPath {
  const pts: [number, number][] = [];
  let q = startQ,
    r = startR,
    enterW = -1;
  let hx = heading[0],
    hz = heading[1];
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl;
  hz /= hl;
  for (let i = 0; i < steps; i++) {
    // Periodically swing the heading ±60° to force a turn onto a crossing corridor. Alternate
    // the turn sign so the route weaves rather than spiralling off one way.
    if (turn > 0 && i > 0 && i % (turn + 2) === 0) {
      const a = (Math.floor(i / (turn + 2)) % 2 === 0 ? 1 : -1) * (Math.PI / 3);
      const nx = hx * Math.cos(a) - hz * Math.sin(a);
      const nz = hx * Math.sin(a) + hz * Math.cos(a);
      hx = nx;
      hz = nz;
    }
    const ds = _doorsLocal(q, r).filter((w) => w !== enterW);
    if (ds.length === 0) break;
    const [cx, cz] = hexToWorld(q, r);
    let bestW = ds[0],
      bestDot = -2,
      bx = 0,
      bz = 0;
    for (const w of ds) {
      const [mx, mz] = _doorMidWorld(q, r, w);
      let dx = mx - cx,
        dz = mz - cz;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const dot = dx * hx + dz * hz;
      if (dot > bestDot) {
        bestDot = dot;
        bestW = w;
        bx = dx;
        bz = dz;
      }
    }
    pts.push(_doorMidWorld(q, r, bestW));
    // turn>0: heading follows the door we took (path bends). turn=0: keep original heading.
    if (turn > 0) {
      hx = bx;
      hz = bz;
    }
    const [dq, dr] = WALL_STEP[bestW];
    q += dq;
    r += dr;
    enterW = (bestW + 3) % 6;
    if (isCenter(q, r)) break;
  }
  return { pts };
}

// Axial step taken when leaving through wall i (verified: shared edge gap == 0).
export const WALL_STEP: Record<number, [number, number]> = {
  0: [1, 0],
  1: [0, 1],
  2: [-1, 1],
  3: [-1, 0],
  4: [0, -1],
  5: [1, -1],
};
export function neighborOf(q: number, r: number, wall: number): [number, number] {
  const [dq, dr] = WALL_STEP[wall];
  return [q + dq, r + dr];
}

// --- BigInt-coord content (for the floating origin: true coords are astronomically large,
// so content must be computed in BigInt while rendering stays in small local floats) ---

const _mod3 = (n: bigint) => ((n % 3n) + 3n) % 3n;
export function isCenterBig(q: bigint, r: bigint): boolean {
  return _mod3(q + 2n * r) === 0n;
}
export function neighborOfBig(q: bigint, r: bigint, wall: number): [bigint, bigint] {
  const [dq, dr] = WALL_STEP[wall];
  return [q + BigInt(dq), r + BigInt(dr)];
}
export function isDoorBig(q: bigint, r: bigint, wall: number): boolean {
  if (isCenterBig(q, r)) return false;
  const [nq, nr] = neighborOfBig(q, r, wall);
  if (isCenterBig(nq, nr)) return false;
  return true;
}

// "Flower" tiling: 1/3 of hexes are sealed CENTRES (a 3-colouring sublattice).
// Each ring (non-centre) hex is surrounded by 3 centres on alternating walls, leaving
// exactly 3 doors on its other (alternating) walls. A door is an edge between two ring
// hexes; edges touching a sealed centre are solid. Both sides always agree -> consistent.
const m3 = (n: number) => ((n % 3) + 3) % 3;
export function isCenter(q: number, r: number): boolean {
  return m3(q + 2 * r) === 0;
}

// Whether the edge on wall `wall` of hex (q,r) is a doorway (passable).
export function isDoor(q: number, r: number, wall: number): boolean {
  if (isCenter(q, r)) return false; // sealed centres have no doors
  const [nq, nr] = neighborOf(q, r, wall);
  if (isCenter(nq, nr)) return false; // wall facing a sealed centre is solid
  return true;
}

export function doorWallsFor(q: number, r: number): number[] {
  const out: number[] = [];
  for (let w = 0; w < 6; w++) if (isDoor(q, r, w)) out.push(w);
  return out;
}

// Returns the 6 vertices of the hexagon floor (y=0) in order.
export function hexVertices(radius = HEX_RADIUS): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6; // 30deg offset -> flat-top
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

// Cheap deterministic 0..1 hash so a book's look is stable per slot (no per-frame flicker).
export function hash01(n: number): number {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  x = x - Math.floor(x);
  return x;
}

// Each wall connects vertex i -> i+1. Returns midpoint, length, and rotation about Y.
export function hexWalls(radius = HEX_RADIUS) {
  const v = hexVertices(radius);
  return v.map(([x1, z1], i) => {
    const [x2, z2] = v[(i + 1) % 6];
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const rotY = Math.atan2(dz, dx);
    return { index: i, mid: [mx, mz] as [number, number], length, rotY };
  });
}
