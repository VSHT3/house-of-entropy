"use client";

// Procedural, file-free textures for the library surfaces.
//
// Each texture is generated ONCE into an offscreen canvas and wrapped in a
// CanvasTexture singleton, then shared by every wall/floor/ceiling/shelf in
// every hex. Sharing the same texture + material instance means the GPU
// uploads each map a single time; per-hex cost is zero. Never call these in a
// frame loop — call once at module scope (lazy) and reuse the ref.
//
// These are PATTERNED (marble tiles, ashlar blocks, coffered ceiling, ribbed
// spines) drawn with crisp canvas primitives layered over value-noise grit, so
// the surfaces read as architecture rather than vague speckle. Normal maps are
// derived from a luminance heightfield (Sobel) so the lamp catches the relief.
//
// No network, no asset files (keeps the standalone/Docker image lean), fully
// deterministic. Tileable so RepeatWrapping shows no visible seams.

import * as THREE from "three";

// mulberry32 deterministic PRNG so the look is stable per build.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise lattice, smooth-interpolated, wrap-indexed for seamless edges.
function makeNoise(size: number, cells: number, seed: number): Float32Array {
  const rand = rng(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx) % cells;
      const y0 = Math.floor(fy) % cells;
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const sx = smooth(fx - Math.floor(fx));
      const sy = smooth(fy - Math.floor(fy));
      const a = lattice[y0 * cells + x0];
      const b = lattice[y0 * cells + x1];
      const c = lattice[y1 * cells + x0];
      const d = lattice[y1 * cells + x1];
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

// Multi-octave fractal noise.
function fbm(size: number, seed: number, octaves = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o;
    const n = makeNoise(size, cells, seed + o * 1013);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function ctxOf(size: number) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  return { cv, ctx };
}

// Paint an fbm field as a subtle multiply-grit overlay on top of whatever the
// canvas already holds. tint<1 darkens troughs, amp controls contrast.
function overlayNoise(ctx: CanvasRenderingContext2D, size: number, seed: number, amp: number) {
  const f = fbm(size, seed, 5);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const g = 1 - amp * 0.5 + f[i] * amp;
    const p = i * 4;
    img.data[p] = Math.min(255, img.data[p] * g);
    img.data[p + 1] = Math.min(255, img.data[p + 1] * g);
    img.data[p + 2] = Math.min(255, img.data[p + 2] * g);
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(cv: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

// ---------------------------------------------------------------------------
// Heightfield -> tangent-space normal map (Sobel). Reads the colour map's own
// luminance so relief lines up with the painted pattern (mortar grooves etc).
// ---------------------------------------------------------------------------
function normalFromCanvas(cv: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const size = cv.width;
  const src = cv.getContext("2d")!.getImageData(0, 0, size, size).data;
  const lum = (x: number, y: number) => {
    const i = (((y + size) % size) * size + ((x + size) % size)) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  const { cv: out, ctx } = ctxOf(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const p = (y * size + x) * 4;
      img.data[p] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[p + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[p + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}


// ===========================================================================
// WOOD — directional grain + ring streaks (shelf boards).
// ===========================================================================
function buildWood(size = 256, seed = 21): HTMLCanvasElement {
  const [br, bg, bb] = [0x55, 0x40, 0x2c]; // lighter warm wood (was 0x3b2c1d)
  const grain = fbm(size, seed, 4);
  const { cv, ctx } = ctxOf(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const ring = Math.sin((grain[i] * 6 + (x / size) * 2) * Math.PI) * 0.5 + 0.5;
      const g = 0.7 + grain[i] * 0.3 + ring * 0.18;
      const p = i * 4;
      img.data[p] = Math.min(255, br * g);
      img.data[p + 1] = Math.min(255, bg * g);
      img.data[p + 2] = Math.min(255, bb * g);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ===========================================================================
// BOOK SPINE ATLAS — a 4x4 grid of 16 distinct, detailed antique book spines.
// Each instanced book samples ONE cell (via a per-instance uv offset) so a
// shelf reads as many different bound volumes, not one repeated box. Drawn on a
// near-white base so the per-book instanceColor tints each spine to its own hue
// while keeping the gilt/ink detail. Cells leave a thin dark gutter = the gap
// between books. One shared texture; per-book variety comes from UV + colour.
// ===========================================================================
export const SPINE_ATLAS_COLS = 6;
export const SPINE_ATLAS_ROWS = 6;

// Draw ONE antique book spine into rect [x,y,w,h]. style varies the look.
// Photoreal goal: tooled leather with fine grain mottle, raised hubs (sewn-cord
// bands) with proper highlight/shadow, an inset morocco title label with faux
// gilt lettering, a foot tooling block, gilt head/foot rules, and scuffed worn
// edges. Drawn near-white so the per-book instanceColor tints each volume.
function drawSpine(ctx: CanvasRenderingContext2D, gx: number, gy: number, gw: number, gh: number, style: number) {
  const r = rng(style * 977 + 13);
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, gy, gw, gh);
  ctx.clip();
  const x = gx, y = gy, w = gw, h = gh;
  const cx = x + w / 2;

  // 1) leather base (near-white so instanceColor tints it) + fine grain mottle.
  ctx.fillStyle = "#d8d4ca";
  ctx.fillRect(x, y, w, h);
  // pebbled leather grain: many tiny tonal blotches
  for (let i = 0; i < 90; i++) {
    const t = (r() - 0.5) * 46;
    const a = 0.04 + r() * 0.07;
    ctx.fillStyle = t < 0 ? `rgba(0,0,0,${a})` : `rgba(255,250,238,${a})`;
    ctx.beginPath();
    ctx.ellipse(x + r() * w, y + r() * h, w * (0.02 + r() * 0.05), w * (0.02 + r() * 0.05), 0, 0, 7);
    ctx.fill();
  }

  // 2) curved-leather shading: dark at both edges, soft sheen down the centre.
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(0.14, "rgba(0,0,0,0.05)");
  g.addColorStop(0.5, "rgba(255,255,255,0.14)");
  g.addColorStop(0.86, "rgba(0,0,0,0.05)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  const blind = style % 7 === 0; // a few books have blind (un-gilt) tooling
  const gilt = blind ? "rgba(60,44,20,0.85)" : "rgba(198,158,74,0.96)";
  const giltHi = blind ? "rgba(90,68,32,0.7)" : "rgba(236,206,128,0.95)";

  // 3) raised hubs (sewn-cord bands across the spine). 4–5 evenly spaced bands
  // divide the spine into panels — the classic antique look.
  const nBands = 4 + (style % 2);
  const top = y + h * 0.06;
  const bot = y + h * 0.94;
  const bandYs: number[] = [];
  for (let i = 0; i < nBands; i++) bandYs.push(top + ((bot - top) * (i + 1)) / (nBands + 1));
  const hub = (by: number) => {
    const hh = h * 0.018;
    // shadow under, body, highlight crest on top — reads as a rounded ridge
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, by + hh * 0.4, w, hh * 1.4);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x, by - hh * 1.4, w, hh * 2.6);
    ctx.fillStyle = "rgba(255,250,235,0.5)";
    ctx.fillRect(x, by - hh * 0.7, w, hh * 0.8);
    // thin gilt rule riding the band
    ctx.fillStyle = gilt;
    ctx.fillRect(x + w * 0.08, by - hh * 0.1, w * 0.84, h * 0.004);
  };
  for (const by of bandYs) hub(by);

  // 4) title label in the 2nd panel from top: inset morocco leather + gilt frame.
  const pTop = bandYs[0];
  const pBot = bandYs[1];
  const labelMid = (pTop + pBot) / 2;
  const labelH = (pBot - pTop) * 0.66;
  const labelTones = ["#4a1612", "#161e3a", "#14120e", "#13301f", "#3a1430"]; // maroon/navy/black/forest/aubergine morocco
  ctx.fillStyle = labelTones[style % labelTones.length];
  const lx = x + w * 0.1, lw = w * 0.8;
  ctx.fillRect(lx, labelMid - labelH / 2, lw, labelH);
  // double gilt frame
  ctx.strokeStyle = gilt;
  ctx.lineWidth = w * 0.03;
  ctx.strokeRect(lx, labelMid - labelH / 2, lw, labelH);
  ctx.strokeStyle = giltHi;
  ctx.lineWidth = w * 0.012;
  ctx.strokeRect(lx + w * 0.05, labelMid - labelH / 2 + w * 0.05, lw - w * 0.1, labelH - w * 0.1);
  // faux gilt title lettering: 2–3 rows of short glyph ticks
  ctx.fillStyle = gilt;
  const rows = 2 + (style % 2);
  for (let rr = 0; rr < rows; rr++) {
    const ly = labelMid - labelH * 0.28 + (rr * labelH * 0.56) / Math.max(1, rows - 1);
    let gxk = lx + w * 0.18;
    const end = lx + lw - w * 0.18;
    while (gxk < end) {
      const gwk = w * (0.04 + r() * 0.07); // glyph width
      ctx.fillRect(gxk, ly - h * 0.009, gwk, h * 0.018);
      gxk += gwk + w * 0.03; // letter spacing
    }
  }

  // 5) foot panel ornament: a small gilt tooling motif (lozenge + corner dots).
  const fTop = bandYs[nBands - 1];
  const fy = (fTop + bot) / 2;
  ctx.fillStyle = gilt;
  ctx.beginPath();
  const s = w * 0.13;
  ctx.moveTo(cx, fy - s);
  ctx.lineTo(cx + s * 0.66, fy);
  ctx.lineTo(cx, fy + s);
  ctx.lineTo(cx - s * 0.66, fy);
  ctx.closePath();
  ctx.fill();
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dx * w * 0.26, fy, w * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6) gilt rules at head and foot framing the whole spine.
  ctx.fillStyle = gilt;
  ctx.fillRect(x + w * 0.1, y + h * 0.035, w * 0.8, h * 0.006);
  ctx.fillRect(x + w * 0.1, y + h * 0.96, w * 0.8, h * 0.006);

  // 7) worn/scuffed edges: lighten the very edges where leather rubs off, and a
  // few random scuffs, so no two spines read as factory-clean.
  const wear = ctx.createLinearGradient(x, 0, x + w * 0.1, 0);
  wear.addColorStop(0, "rgba(210,196,170,0.5)");
  wear.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wear;
  ctx.fillRect(x, y, w * 0.1, h);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(${200 + r() * 40},${188 + r() * 40},${160 + r() * 40},${0.1 + r() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(x + r() * w, y + r() * h, w * 0.04, h * 0.012, r() * 6, 0, 7);
    ctx.fill();
  }

  ctx.restore();
}

function buildSpineAtlas(size = 2048): HTMLCanvasElement {
  const { cv, ctx } = ctxOf(size);
  // dark gutter between books shows through the thin gaps
  ctx.fillStyle = "#1a1510";
  ctx.fillRect(0, 0, size, size);
  const cw = size / SPINE_ATLAS_COLS;
  const ch = size / SPINE_ATLAS_ROWS;
  const gap = cw * 0.04; // gutter between adjacent spines
  let style = 0;
  for (let ry = 0; ry < SPINE_ATLAS_ROWS; ry++) {
    for (let cx = 0; cx < SPINE_ATLAS_COLS; cx++) {
      drawSpine(ctx, cx * cw + gap, ry * ch, cw - gap * 2, ch, style++);
    }
  }
  // unifying fine leather grain over the whole atlas
  overlayNoise(ctx, size, 5, 0.10);
  return cv;
}

// ---------------------------------------------------------------------------
// Lazy singletons. Built on first access (client only — needs document).
// Each "*Tex" pairs the colour map with a normal map derived from the SAME
// canvas, so grooves/bevels physically catch the lamp.
// ---------------------------------------------------------------------------
type Pair = { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
function pair(cv: HTMLCanvasElement, strength: number, rx = 1, ry = 1): Pair {
  const map = toTexture(cv, rx, ry);
  const normalMap = normalFromCanvas(cv, strength);
  normalMap.repeat.set(rx, ry);
  return { map, normalMap };
}

// Real photographed PBR sets (Poly Haven, CC0): 1k jpg maps under
// public/textures/<dir>/ (diff/nor/rough). Unlike the canvas textures these
// load image files; one shared loader, one set of GPU uploads, reused by every
// hex. Floor: "marble_tiles". Walls: "wood_plank_wall". World-space UV in
// HexRoom tiles them continuously, so the textures stay at repeat=1.
type PhotoSet = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};
const _photoCache = new Map<string, PhotoSet>();
export function photoTex(dir: string): PhotoSet {
  const hit = _photoCache.get(dir);
  if (hit) return hit;
  const loader = new THREE.TextureLoader();
  const load = (file: string, srgb: boolean) => {
    const t = loader.load(`/textures/${dir}/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const set: PhotoSet = {
    map: load("diff.jpg", true),
    normalMap: load("nor.jpg", false),
    roughnessMap: load("rough.jpg", false),
  };
  _photoCache.set(dir, set);
  return set;
}

let _wood: Pair | null = null;
let _spine: Pair | null = null;

export function woodTex() {
  return (_wood ??= pair(buildWood(), 2));
}
export function spineTex() {
  // Whole atlas, no repeat — per-book cell chosen via per-instance UV offset in
  // the shader (see Bookshelf). Normal map gives the hubs/labels relief.
  if (_spine) return _spine;
  const cv = buildSpineAtlas();
  const map = toTexture(cv, 1, 1);
  const normalMap = normalFromCanvas(cv, 4);
  return (_spine = { map, normalMap });
}
