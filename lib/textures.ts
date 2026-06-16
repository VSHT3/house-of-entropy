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
// FLOOR — old castle flagstones: large IRREGULAR stones of varied size with
// organic wobbly mortar joints, heavy mottling, worn highlights. Avoids the
// "clean tile grid" look by random-merging cells and jittering every edge.
// ===========================================================================
function buildFloor(size = 1024): HTMLCanvasElement {
  const { cv, ctx } = ctxOf(size);
  ctx.fillStyle = "#171310"; // deep mortar fills the gaps
  ctx.fillRect(0, 0, size, size);

  const cells = 5; // coarse base grid; some cells merge into bigger slabs
  const cw = size / cells;
  const occupied: boolean[] = new Array(cells * cells).fill(false);
  const stoneBase = [0x92, 0x88, 0x76]; // warm grey limestone

  // a wobbly-edged rounded rect path (organic, hand-cut stone)
  const wobbleStone = (gx: number, gy: number, gw: number, gh: number, seed: number) => {
    const r = rng(seed);
    const inset = size * 0.02;
    const x0 = gx + inset, y0 = gy + inset;
    const x1 = gx + gw - inset, y1 = gy + gh - inset;
    // edge jitter kept < inset so a stone never breaches its cell border —
    // this is what keeps the whole texture seamlessly tileable.
    const wob = () => (r() - 0.5) * size * 0.014;
    ctx.beginPath();
    const steps = 6;
    // top edge
    for (let i = 0; i <= steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      i === 0 ? ctx.moveTo(px, y0 + wob()) : ctx.lineTo(px, y0 + wob());
    }
    for (let i = 1; i <= steps; i++) ctx.lineTo(x1 + wob(), y0 + ((y1 - y0) * i) / steps);
    for (let i = 1; i <= steps; i++) ctx.lineTo(x1 - ((x1 - x0) * i) / steps, y1 + wob());
    for (let i = 1; i <= steps; i++) ctx.lineTo(x0 + wob(), y1 - ((y1 - y0) * i) / steps);
    ctx.closePath();

    const tone = (r() - 0.5) * 30;
    ctx.fillStyle = `rgb(${stoneBase[0] + tone},${stoneBase[1] + tone},${stoneBase[2] + tone})`;
    ctx.fill();
    // worn highlight rim (top/left) + recessed shadow (bottom/right)
    ctx.save();
    ctx.clip();
    const hl = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
    hl.addColorStop(0, "rgba(255,248,230,0.16)");
    hl.addColorStop(0.5, "rgba(0,0,0,0)");
    hl.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = hl;
    ctx.fillRect(gx, gy, gw, gh);
    // per-stone blotches for veined limestone
    for (let s = 0; s < 5; s++) {
      ctx.fillStyle = `rgba(${40 + r() * 60},${36 + r() * 55},${28 + r() * 45},0.10)`;
      ctx.beginPath();
      ctx.ellipse(gx + r() * gw, gy + r() * gh, gw * (0.1 + r() * 0.2), gh * (0.08 + r() * 0.15), r() * 6, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  };

  let seed = 100;
  for (let ry = 0; ry < cells; ry++) {
    for (let cx = 0; cx < cells; cx++) {
      if (occupied[ry * cells + cx]) continue;
      const r = rng(seed++);
      // sometimes make a 2-wide or 2-tall slab if room (varied stone sizes).
      // Never merge across the right/bottom wrap edge — keeps the tile seamless.
      let gw = 1, gh = 1;
      if (cx + 1 < cells && !occupied[ry * cells + cx + 1] && r() < 0.3) gw = 2;
      else if (ry + 1 < cells && !occupied[(ry + 1) * cells + cx] && r() < 0.3) gh = 2;
      for (let yy = 0; yy < gh; yy++)
        for (let xx = 0; xx < gw; xx++) occupied[(ry + yy) * cells + cx + xx] = true;
      wobbleStone(cx * cw, ry * cw, gw * cw, gh * cw, seed);
    }
  }
  // Seamless noise overlay (fbm is already tileable) so the grit also wraps.
  overlayNoise(ctx, size, 13, 0.3);
  return cv;
}

// ===========================================================================
// WALLS — dark walnut wainscot paneling: a tight grid of recessed framed
// panels with deep grooves, an inner moulding line, and rich vertical grain.
// Dark + saturated (not the flat orange) so it reads as old library joinery.
// ===========================================================================
function buildWall(size = 1024): HTMLCanvasElement {
  const { cv, ctx } = ctxOf(size);
  // deep walnut grain backdrop
  const grain = fbm(size, 41, 5);
  const img = ctx.createImageData(size, size);
  const wood = [0x4a, 0x2f, 0x1c]; // dark walnut (was too light/orange before)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // tight vertical grain: fine fbm modulated by a higher-freq vertical streak
      const streak = Math.sin((grain[i] * 7 + (x / size) * 9) * Math.PI) * 0.5 + 0.5;
      const g = 0.66 + grain[i] * 0.32 + streak * 0.12;
      const p = i * 4;
      img.data[p] = Math.min(255, wood[0] * g);
      img.data[p + 1] = Math.min(255, wood[1] * g);
      img.data[p + 2] = Math.min(255, wood[2] * g);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Tight 3x3 grid of recessed framed panels (wainscot). Smaller panels read
  // far richer than a couple of big flat fields.
  const cols = 3;
  const rows = 3;
  const pw = size / cols;
  const ph = size / rows;
  const stile = Math.min(pw, ph) * 0.16; // frame rail/stile width

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * pw + stile;
      const y = ry * ph + stile;
      const w = pw - stile * 2;
      const h = ph - stile * 2;
      const groove = stile * 0.45;

      // 1) deep recess groove around the panel (dark) — frame sits proud
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x - groove, y - groove, w + groove * 2, groove);
      ctx.fillRect(x - groove, y + h, w + groove * 2, groove);
      ctx.fillRect(x - groove, y - groove, groove, h + groove * 2);
      ctx.fillRect(x + w, y - groove, groove, h + groove * 2);

      // 2) the recessed field is slightly darker than the frame
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x, y, w, h);

      // 3) chamfer bevels INTO the recess: shadow on top/left, light bottom/right
      const bv = groove * 0.9;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(x, y, w, bv);
      ctx.fillRect(x, y, bv, h);
      ctx.fillStyle = "rgba(255,210,160,0.14)";
      ctx.fillRect(x, y + h - bv, w, bv);
      ctx.fillRect(x + w - bv, y, bv, h);

      // 4) inner gilt moulding line — the "fancy" detail
      ctx.strokeStyle = "rgba(150,120,60,0.5)";
      ctx.lineWidth = size * 0.004;
      const m = w * 0.14;
      ctx.strokeRect(x + m, y + m, w - m * 2, h - m * 2);

      // 5) frame highlight where the proud rail catches light (top/left)
      ctx.fillStyle = "rgba(255,220,170,0.1)";
      ctx.fillRect(x - groove, y - groove, w + groove * 2, groove * 0.4);
      ctx.fillRect(x - groove, y - groove, groove * 0.4, h + groove * 2);
    }
  }
  return cv;
}

// ===========================================================================
// DOORWAY REVEAL — plain grey stone with only faint mottle. Lines the door
// opening so the passage reads as a simple cut stone reveal, not busy ashlar.
// ===========================================================================
function buildDoorStone(size = 256): HTMLCanvasElement {
  const { cv, ctx } = ctxOf(size);
  ctx.fillStyle = "#4d4c4a"; // dark grey stone
  ctx.fillRect(0, 0, size, size);
  overlayNoise(ctx, size, 17, 0.14); // just a little tonal variation
  return cv;
}

// ===========================================================================
// CEILING — coffered panels: recessed square caissons with raised frames.
// ===========================================================================
function buildCeiling(size = 1024): HTMLCanvasElement {
  const { cv, ctx } = ctxOf(size);
  const panels = 3;
  const t = size / panels;
  ctx.fillStyle = "#3a3228"; // raised frame / beams
  ctx.fillRect(0, 0, size, size);
  const frame = t * 0.16;
  for (let py = 0; py < panels; py++) {
    for (let px = 0; px < panels; px++) {
      const x = px * t + frame;
      const y = py * t + frame;
      const w = t - frame * 2;
      const h = t - frame * 2;
      // recessed sunken panel (darker), with inner bevel shading
      ctx.fillStyle = "#26201a";
      ctx.fillRect(x, y, w, h);
      // bevel: dark on top/left (in shadow because recessed), light bottom/right
      const bv = frame * 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x, y, w, bv);
      ctx.fillRect(x, y, bv, h);
      ctx.fillStyle = "rgba(255,230,190,0.10)";
      ctx.fillRect(x, y + h - bv, w, bv);
      ctx.fillRect(x + w - bv, y, bv, h);
      // central rosette dot
      ctx.fillStyle = "rgba(120,100,70,0.5)";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, w * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  overlayNoise(ctx, size, 31, 0.14);
  return cv;
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
export const SPINE_ATLAS_COLS = 4;
export const SPINE_ATLAS_ROWS = 4;

// Draw ONE antique book spine into rect [x,y,w,h]. style 0..15 varies the look.
// Design goal: a tall PLAIN leather spine dominated by empty leather, with a
// single bold gilt title label and at most one pair of raised bands framing it.
// Too many horizontal lines read as "many tiny books stacked" — so keep it sparse.
function drawSpine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: number) {
  const r = rng(style * 977 + 13);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // leather base (near-white so per-book instanceColor tints it)
  ctx.fillStyle = "#d6d2c8";
  ctx.fillRect(x, y, w, h);

  // curved-leather shading: dark at both edges, soft sheen down the centre
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.16, "rgba(0,0,0,0.06)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(0.84, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  const gilt = style % 6 === 0 ? "rgba(70,52,22,0.9)" : "rgba(176,138,58,0.95)"; // mostly gilt, some blind
  const cx = x + w / 2;

  // helper: a raised band (thin highlight crest with shadow above/below)
  const band = (by: number) => {
    const hh = h * 0.012;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, by - hh * 1.8, w, hh);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(x, by - hh * 0.4, w, hh * 1.3);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(x, by + hh, w, hh);
  };

  // ONE title label, set in the upper third, framed by a pair of bands.
  const labelMid = y + h * (0.26 + (style % 3) * 0.04);
  const labelH = h * 0.16;
  const bandTop = labelMid - labelH * 0.85;
  const bandBot = labelMid + labelH * 0.85;
  if (style % 4 !== 3) {
    band(bandTop);
    band(bandBot);
  }
  // inset leather title panel (dark maroon / navy / black morocco)
  const labelTones = ["rgba(74,22,18,0.62)", "rgba(22,30,58,0.6)", "rgba(20,18,16,0.6)"];
  ctx.fillStyle = labelTones[style % labelTones.length];
  ctx.fillRect(x + w * 0.12, labelMid - labelH / 2, w * 0.76, labelH);
  ctx.strokeStyle = gilt;
  ctx.lineWidth = w * 0.035;
  ctx.strokeRect(x + w * 0.12, labelMid - labelH / 2, w * 0.76, labelH);
  // a couple of embossed title bars
  ctx.fillStyle = gilt;
  for (let l = 0; l < 2; l++) {
    const tw = w * (0.46 + r() * 0.14);
    ctx.fillRect(cx - tw / 2, labelMid - labelH * 0.18 + l * labelH * 0.36, tw, h * 0.014);
  }

  // a single small gilt ornament low on the spine (crest / star), most books
  if (style % 3 !== 2) {
    const oy = y + h * 0.7;
    const s = w * 0.16;
    ctx.fillStyle = gilt;
    ctx.beginPath();
    ctx.moveTo(cx, oy - s);
    ctx.lineTo(cx + s * 0.7, oy);
    ctx.lineTo(cx, oy + s);
    ctx.lineTo(cx - s * 0.7, oy);
    ctx.closePath();
    ctx.fill();
  }

  // gilt rule near head and foot only (frames the whole spine)
  ctx.fillStyle = gilt;
  ctx.fillRect(x + w * 0.12, y + h * 0.04, w * 0.76, h * 0.007);
  ctx.fillRect(x + w * 0.12, y + h * 0.95, w * 0.76, h * 0.007);

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

let _floor: Pair | null = null;
let _wall: Pair | null = null;
let _ceil: Pair | null = null;
let _wood: Pair | null = null;
let _spine: Pair | null = null;
let _door: Pair | null = null;

export function floorTex() {
  // repeat handled by world-space UV in HexRoom (FLOOR_TILE) so flagstones run
  // continuously across hex boundaries — keep the texture itself at 1x.
  return (_floor ??= pair(buildFloor(), 5, 1, 1));
}
export function wallTex() {
  // one raised-and-fielded paneling unit per wall face
  return (_wall ??= pair(buildWall(), 5, 1, 1));
}
export function ceilingTex() {
  return (_ceil ??= pair(buildCeiling(), 7, 1, 1));
}
export function woodTex() {
  return (_wood ??= pair(buildWood(), 2));
}
export function doorTex() {
  return (_door ??= pair(buildDoorStone(), 1.5, 1, 1));
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
