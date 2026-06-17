"use client";

import { useMemo, useRef, useLayoutEffect } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ThreeEvent } from "@react-three/fiber";
import {
  BOOKS_PER_SHELF,
  SHELVES_PER_WALL,
  WALL_HEIGHT,
  WALL_THICKNESS,
  hash01,
} from "@/lib/babel";
import { openBook } from "./bookStore";
import { isTutorialBook } from "@/lib/library";
import { woodTex, spineTex, SPINE_ATLAS_COLS } from "@/lib/textures";

// Shared shelf-board material, built once and reused by every shelf in every hex.
let _boardMat: THREE.MeshStandardMaterial | null = null;
function boardMat() {
  if (_boardMat) return _boardMat;
  const t = woodTex();
  return (_boardMat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.95,
  }));
}

// Shared spine material for the instanced books. The map is a 4x4 ATLAS of 16
// distinct spines; each book picks one cell via a per-instance `aCell` attribute
// (vec2 = col,row), remapped onto the standard map/normal UVs in the shader. So
// one shared material renders many different-looking bound books. Per-book hue
// still comes from instanceColor (multiplied in). toneMapped=false keeps the
// hover-brighten punchy. Built once, reused by every shelf.
const ATLAS = SPINE_ATLAS_COLS; // square atlas (COLS === ROWS)
let _spineMat: THREE.MeshStandardMaterial | null = null;
function spineMat() {
  if (_spineMat) return _spineMat;
  const t = spineTex();
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.78,
    toneMapped: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "attribute vec2 aCell;\nvarying vec2 vCell;\n" +
      shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n  vCell = aCell;"
      );
    // Remap the sampled UVs into the chosen atlas cell. We only rewrite the two
    // texture2D fetch sites (map + normal), leaving three's surrounding logic
    // untouched. A tiny inset avoids bleeding into neighbouring cells.
    const cell = (uv: string) =>
      `texture2D( $TEX, (vCell + clamp(${uv}, 0.004, 0.996)) / ${ATLAS.toFixed(1)} )`;
    shader.fragmentShader =
      "varying vec2 vCell;\n" +
      shader.fragmentShader
        .replace(
          "texture2D( map, vMapUv )",
          cell("vMapUv").replace("$TEX", "map")
        )
        .replace(
          /texture2D\( normalMap, vNormalMapUv \)/g,
          cell("vNormalMapUv").replace("$TEX", "normalMap")
        );
  };
  // changing onBeforeCompile requires a unique cache key
  mat.customProgramCacheKey = () => "spine-atlas";
  return (_spineMat = mat);
}

// instanceColor (the per-book hue) is applied by three to EVERY material on the
// mesh. We only want it to tint the leather (spine + cover), never the cream
// pages. This snippet strips the instanceColor multiply from a material so its
// own map shows through untinted.
function stripInstanceColor(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "" // drop vColor / instanceColor multiply
    );
  };
  mat.customProgramCacheKey = () => "no-instance-color";
}

// Cream page block (the text block): a faint stack-of-leaves striping along the
// page axis so the visible head/tail/fore-edge read as paper, not a slab. NOT
// tinted by the per-book hue.
let _pagesMat: THREE.MeshStandardMaterial | null = null;
function pagesMat() {
  if (_pagesMat) return _pagesMat;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e2d8bd"; // aged cream
  ctx.fillRect(0, 0, 256, 256);
  // fine leaf lines (paper stack). Strong enough to catch the lamp via normalScale.
  for (let x = 0; x < 256; x += 1) {
    const v = (x % 3 === 0) ? "rgba(120,104,72,0.28)" : "rgba(255,252,240,0.12)";
    ctx.fillStyle = v;
    ctx.fillRect(x, 0, 1, 256);
  }
  // a little uneven yellowing
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(150,128,84,${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 40, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  stripInstanceColor(mat);
  return (_pagesMat = mat);
}

// Tooled-leather cover boards (front board edge, back, head/tail caps). Tinted
// by the per-book hue like the spine so a book is one consistent colour.
let _coverMat: THREE.MeshStandardMaterial | null = null;
function coverMat() {
  if (_coverMat) return _coverMat;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#c9c3b6"; // near-white leather (instanceColor tints it)
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    const t = (Math.random() - 0.5) * 50;
    ctx.fillStyle = t < 0 ? `rgba(0,0,0,${0.05 + Math.random() * 0.06})` : `rgba(255,250,238,${0.05 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return (_coverMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
}

// ---------------------------------------------------------------------------
// One detailed BOOK geometry, instanced for every book on every shelf (so the
// whole shelf is still ~1 draw call). Unit cube space, scaled per instance by
// (bookW, bookH, BOOK_DEPTH). Local axes: +z = spine (faces the room), -z =
// fore-edge (into the wall); x = width, y = height. Built from boxes merged into
// ONE geometry with three material groups: 0 = spine atlas face, 1 = cream page
// block, 2 = leather cover. The cover is a slab at the spine; the page block is
// inset (narrower w/h) and extends from just behind the spine to the fore-edge,
// so the cream pages sit proud-inset behind the leather spine — a real book.
// ---------------------------------------------------------------------------
const MAT_SPINE = 0;
const MAT_PAGES = 1;
const MAT_COVER = 2;

// A solid axis-aligned box spanning [x0,x1]×[y0,y1]×[z0,z1] (non-indexed, 36
// verts, all 6 faces — so it renders from every angle, no 1px backface issue).
function boxBetween(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

let _bookGeo: THREE.BufferGeometry | null = null;
function bookGeometry(): THREE.BufferGeometry {
  if (_bookGeo) return _bookGeo;

  // Upright book, SPINE faces the room (+z). Unit cube space; x = width, y =
  // height, z = depth (+z room / -z into wall). The cover is built from SOLID
  // THICK BOARDS (not thin box faces) so each board reads as a real slab with
  // visible thickness from inside and outside — a left board, a right board, a
  // tail (bottom) board, and the spine slab. The TOP is left open, so you look
  // down into the cream page block recessed inside the board frame.
  const T = 0.1; // cover-board thickness
  const spineZ0 = 0.42; // spine slab front face at z = 0.5

  const parts: THREE.BufferGeometry[] = [];
  const mat: number[] = [];
  const add = (g: THREE.BufferGeometry, m: number) => { parts.push(g); mat.push(m); };

  // Spine slab: thin in z, full width/height. Its +z face shows the atlas; the
  // whole slab is one group, but only +z is really seen (rest abuts boards).
  add(boxBetween(-0.5, 0.5, -0.5, 0.5, spineZ0, 0.5), MAT_SPINE);
  // Left + right cover boards (thick in x), running from back to the spine.
  add(boxBetween(-0.5, -0.5 + T, -0.5, 0.5, -0.5, spineZ0), MAT_COVER);
  add(boxBetween(0.5 - T, 0.5, -0.5, 0.5, -0.5, spineZ0), MAT_COVER);
  // Tail board (thick in y) along the bottom, between the side boards.
  add(boxBetween(-0.5 + T, 0.5 - T, -0.5, -0.5 + T, -0.5, spineZ0), MAT_COVER);
  // Back board (thick in z) closing the rear so you don't see into the wall.
  add(boxBetween(-0.5 + T, 0.5 - T, -0.5 + T, 0.5, -0.5, -0.5 + T), MAT_COVER);
  // Cream page block, recessed just below the board rim (0.47 < 0.5) so the
  // cover boards form a slight lip above the page-tops.
  add(boxBetween(-0.5 + T, 0.5 - T, -0.5 + T, 0.47, -0.5 + T, spineZ0), MAT_PAGES);

  const ni = parts.map((p) => p);
  const merged = mergeGeometries(ni, false);
  merged.clearGroups();
  let start = 0;
  ni.forEach((p, i) => {
    const cnt = p.attributes.position.count;
    merged.addGroup(start, cnt, mat[i]);
    start += cnt;
  });
  _bookGeo = merged;
  return merged;
}

// Material array indexed by MAT_* (spine atlas / cream pages / leather cover).
let _bookMats: THREE.Material[] | null = null;
function bookMats() {
  if (_bookMats) return _bookMats;
  const arr: THREE.Material[] = [];
  arr[MAT_SPINE] = spineMat();
  arr[MAT_PAGES] = pagesMat();
  arr[MAT_COVER] = coverMat();
  return (_bookMats = arr);
}

// Warm, faded leather/paper palette for spines.
const SPINE_COLORS = ["#7b3f2a", "#8a6d3b", "#5c4332", "#6e5a3c", "#894f3a", "#4a5240", "#82724f", "#5a3b2e"];

const BOOK_REACH = 4.0; // max camera-to-book distance (m) a click/hover counts — about one room
const SHELF_BOTTOM = 0.2; // lowest shelf board height (near floor)
// highest shelf board: leave headroom for the tallest book (~0.54 m) so the top
// row doesn't poke through the ceiling at WALL_HEIGHT.
const SHELF_TOP = WALL_HEIGHT - 0.7;
const BOOK_DEPTH = 0.22; // how far a book sticks out from the wall
const SHELF_INSET = 0.05; // books sit slightly proud of the wall face
const BOARD_THICK = 0.04;

type Props = {
  // wall midpoint + rotation in world space (from hexWalls)
  mid: [number, number];
  rotY: number;
  length: number;
  seed: number; // stable per-wall seed for deterministic look
  tq: bigint; // true (BigInt) hex coords + wall index, so a clicked book resolves to a PageCoordBig
  tr: bigint;
  wall: number;
};

export function Bookshelf({ mid, rotY, length, seed, tq, tr, wall }: Props) {
  const rowYs = useMemo(() => {
    const ys: number[] = [];
    const span = SHELF_TOP - SHELF_BOTTOM;
    for (let r = 0; r < SHELVES_PER_WALL; r++) {
      ys.push(SHELF_BOTTOM + (span * r) / (SHELVES_PER_WALL - 1));
    }
    return ys;
  }, []);

  const usableW = length - 0.6; // margin from wall edges (keeps neighbours from colliding at hex corners)
  const slotW = usableW / BOOKS_PER_SHELF;
  const count = BOOKS_PER_SHELF * SHELVES_PER_WALL;

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const baseColors = useRef<THREE.Color[]>([]);
  const hovered = useRef<number | null>(null);
  // Each shelf needs its OWN geometry instance so its per-book aCell attribute
  // doesn't clobber other shelves' (the base geometry is a shared singleton;
  // clone shares the static vertex buffers but lets us attach a unique aCell).
  const bookGeo = useMemo(() => bookGeometry().clone(), []);

  // Brighten the hovered spine, restore the previous one.
  function highlight(id: number | null) {
    const mesh = meshRef.current;
    if (!mesh || hovered.current === id) return;
    const prev = hovered.current;
    if (prev != null && baseColors.current[prev]) mesh.setColorAt(prev, baseColors.current[prev]);
    if (id != null && baseColors.current[id]) {
      mesh.setColorAt(id, baseColors.current[id].clone().multiplyScalar(2.2));
    }
    hovered.current = id;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    baseColors.current = [];
    // per-instance atlas cell (col,row) so each book shows a different spine
    const cells = new Float32Array(count * 2);
    let i = 0;
    for (let row = 0; row < SHELVES_PER_WALL; row++) {
      const y = rowYs[row] + 0.0;
      for (let b = 0; b < BOOKS_PER_SHELF; b++) {
        const h = hash01(seed * 1000 + row * 50 + b);
        const h2 = hash01(seed * 2000 + row * 50 + b);
        const tut = isTutorialBook({ q: tq, r: tr, wall, shelf: row, book: b });
        // fill most of the ~0.6m row pitch so books dominate the wall (little wood shows)
        const bookH = tut ? 0.48 : 0.4 + h * 0.08; // 0.40–0.48 m (fits the ~0.52 m row pitch)
        // pack books nearly edge-to-edge so spines abut like a real shelf (only
        // a thin gap), instead of skinny spines floating in wide gaps.
        const bookW = tut ? slotW * 0.98 : slotW * (0.9 + h2 * 0.08);
        const bookD = (tut ? BOOK_DEPTH * 1.15 : BOOK_DEPTH) * (0.9 + h * 0.18); // vary fore-edge depth
        // local position along the wall: x = left->right, y up, z = book depth (out of wall)
        const lx = -usableW / 2 + slotW * (b + 0.5);
        dummy.position.set(lx, y + bookH / 2, tut ? 0.03 : 0); // tutorial sticks out a touch
        dummy.scale.set(bookW, bookH, bookD);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const c = tut
          ? new THREE.Color("#d9b44a") // distinct warm gold spine
          : new THREE.Color(SPINE_COLORS[Math.floor(hash01(seed * 7 + row * 9 + b) * SPINE_COLORS.length)]);
        baseColors.current[i] = c.clone();
        mesh.setColorAt(i, c);
        // pick one of the 16 atlas cells deterministically
        const cell = Math.floor(hash01(seed * 13 + row * 91 + b * 7) * (ATLAS * ATLAS));
        cells[i * 2] = cell % ATLAS;
        cells[i * 2 + 1] = Math.floor(cell / ATLAS);
        i++;
      }
    }
    mesh.geometry.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 2));
    hovered.current = null;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [rowYs, slotW, usableW, seed, count, tq, tr, wall]);

  // Orient the shelf to match the wall (long axis = local X, same as the wall mesh).
  // Then nudge the whole group toward the room centre so books sit on the inner wall face.
  const inwardLen = WALL_THICKNESS / 2 + SHELF_INSET + BOOK_DEPTH / 2;
  const dist = Math.hypot(mid[0], mid[1]);
  const nx = mid[0] / dist; // outward wall normal (centre -> mid)
  const nz = mid[1] / dist;
  const groupPos: [number, number, number] = [mid[0] - nx * inwardLen, 0, mid[1] - nz * inwardLen];

  return (
    <group position={groupPos} rotation={[0, -rotY, 0]}>
      <group position={[0, 0, 0]}>
        {/* shelf boards */}
        {rowYs.map((y, row) => (
          <mesh key={row} position={[0, y, 0]} material={boardMat()}>
            <boxGeometry args={[usableW + 0.1, BOARD_THICK, BOOK_DEPTH + 0.06]} />
          </mesh>
        ))}
        {/* instanced books (one merged spine/pages/cover geometry per book) */}
        <instancedMesh
          ref={meshRef}
          args={[bookGeo, bookMats(), count]}
          castShadow
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (e.instanceId == null || e.distance > BOOK_REACH) return; // arm's-reach only
            e.stopPropagation();
            const shelf = Math.floor(e.instanceId / BOOKS_PER_SHELF);
            const book = e.instanceId % BOOKS_PER_SHELF;
            openBook({ q: tq, r: tr, wall, shelf, book, page: 0 });
          }}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            if (e.distance > BOOK_REACH) {
              highlight(null);
              document.body.style.cursor = "";
              return;
            }
            e.stopPropagation();
            highlight(e.instanceId ?? null);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            highlight(null);
            document.body.style.cursor = "";
          }}
        />

      </group>
    </group>
  );
}
