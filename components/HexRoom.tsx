"use client";

import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Edges } from "@react-three/drei";
import { hexWalls, HEX_RADIUS, WALL_HEIGHT, WALL_THICKNESS, DOORWAY_WIDTH, DOORWAY_HEIGHT, isDoorBig, neighborOfBig } from "@/lib/babel";
import { photoTex } from "@/lib/textures";
import { Bookshelf } from "./Bookshelf";

// Shared, build-once materials. One instance per surface type, reused by every
// hex in the grid — the textures behind them are singletons too, so the GPU
// uploads each map a single time and per-hex cost is zero. Each material gets a
// colour map + a matching normal map (relief from the painted grooves/bevels).
let _wallMat: THREE.MeshStandardMaterial | null = null;
let _floorMat: THREE.MeshStandardMaterial | null = null;
let _ceilMat: THREE.MeshStandardMaterial | null = null;
function wallMat() {
  if (_wallMat) return _wallMat;
  // Real photographed wood plank wall (Poly Haven "wood_plank_wall", CC0). One
  // tile per wall face; door pillars slice a matching sub-range (panelSliceGeo).
  const t = photoTex("wall");
  return (_wallMat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: t.roughnessMap,
    roughness: 1.0, // modulated by the map
    metalness: 0.0,
  }));
}
function floorMat() {
  if (_floorMat) return _floorMat;
  // Real photographed marble tile floor (Poly Haven "marble_tiles", CC0). The
  // roughness map gives polished/worn variation under the lamp. World-space UV
  // (FLOOR_TILE) tiles it continuously across hex boundaries.
  const t = photoTex("floor");
  return (_floorMat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: t.roughnessMap,
    roughness: 1.0, // modulated by the map
  }));
}
function ceilMat() {
  if (_ceilMat) return _ceilMat;
  // Real photographed lacquered wood panelling (Poly Haven "wooden_panels").
  // Repeat ~3× so panels read at a sane size across the ~9 m hex ceiling.
  const t = photoTex("ceiling");
  for (const m of [t.map, t.normalMap, t.roughnessMap]) m.repeat.set(3, 3);
  return (_ceilMat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: t.roughnessMap,
    roughness: 1.0,
  }));
}
// Doorway jambs/lintel: wood reveal matching the walls, so the opening reads as
// cut through the panelling. Its own texture instance (separate repeat) but the
// same plank-wood maps as the walls (copied into public/textures/door/).
let _doorMat: THREE.MeshStandardMaterial | null = null;
function doorMat() {
  if (_doorMat) return _doorMat;
  const t = photoTex("door");
  for (const m of [t.map, t.normalMap, t.roughnessMap]) m.repeat.set(1, 2); // jambs are tall+narrow
  return (_doorMat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: t.roughnessMap,
    roughness: 1.0,
  }));
}

// A wall-panel box whose front/back face UVs are a SUB-RANGE of the full wall
// texture: u in [u0,u1], v in [v0,v1]. Lets a narrow door pillar show the same
// world-scale paneling as a full solid wall (it renders the matching slice of
// the 3x3 panel layout instead of squeezing the whole panel set into itself).
// Cached by rounded slice key.
const _panelGeoCache = new Map<string, THREE.BoxGeometry>();
function panelSliceGeo(w: number, h: number, d: number, u0: number, u1: number, v0: number, v1: number) {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${u0.toFixed(3)},${u1.toFixed(3)},${v0.toFixed(3)},${v1.toFixed(3)}`;
  const hit = _panelGeoCache.get(key);
  if (hit) return hit;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z; 4 verts each (16..23 = +z, 20..23 = -z).
  // Remap the front (+z, verts 16-19) and back (-z, verts 20-23) faces.
  for (let i = 16; i < 24; i++) {
    const ux = uv.getX(i); // 0..1 within the face
    const uy = uv.getY(i);
    uv.setXY(i, u0 + ux * (u1 - u0), v0 + uy * (v1 - v0));
  }
  uv.needsUpdate = true;
  _panelGeoCache.set(key, g);
  return g;
}

// A single solid wall segment (full height, no door).
function SolidWall({ mid, length, rotY }: { mid: [number, number]; length: number; rotY: number }) {
  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh position={[mid[0], WALL_HEIGHT / 2, mid[1]]} rotation={[0, -rotY, 0]} castShadow receiveShadow material={wallMat()}>
        <boxGeometry args={[length, WALL_HEIGHT, WALL_THICKNESS]} />
        <Edges threshold={15} color="#15100a" />
      </mesh>
    </RigidBody>
  );
}

// A wall with a centred doorway: split into left pillar, right pillar, and lintel above.
function DoorWall({ mid, length, rotY }: { mid: [number, number]; length: number; rotY: number }) {
  const sideW = (length - DOORWAY_WIDTH) / 2;
  const lintelH = WALL_HEIGHT - DOORWAY_HEIGHT;
  // local x offset of each side pillar centre
  const sideOffset = DOORWAY_WIDTH / 2 + sideW / 2;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const place = (lx: number): [number, number] => [mid[0] + cos * lx, mid[1] + sin * lx];
  const [lxA, lzA] = place(-sideOffset);
  const [lxB, lzB] = place(sideOffset);

  // Stone reveal jambs lining the opening (the faces you see passing through):
  // two vertical side jambs at the opening edges + a top jamb under the lintel.
  // Thin slabs slightly proud of the wall thickness so only the reveal shows
  // stone; the big wall faces stay wood.
  const jambT = 0.035; // jamb slab thickness (the strip width along the wall) — slim
  const jambD = WALL_THICKNESS - 0.04; // sit inside the reveal, not proud of the wall
  const edgeX = DOORWAY_WIDTH / 2 - jambT / 2; // jamb hugs the opening edge (edge contact, no face overlap)
  const [jxL, jzL] = place(-edgeX);
  const [jxR, jzR] = place(edgeX);
  const sideH = DOORWAY_HEIGHT - jambT; // meet the top jamb edge-to-edge
  const lintelW = DOORWAY_WIDTH; // exactly fills the gap — edge contact with pillars, no coplanar overlap

  return (
    <RigidBody type="fixed" colliders="cuboid">
      <group>
        {/* wall faces stay wood paneling — UVs sliced so panels match the world
            scale of a full SolidWall (same hex, same length). */}
        <mesh
          position={[lxA, WALL_HEIGHT / 2, lzA]}
          rotation={[0, -rotY, 0]}
          castShadow
          receiveShadow
          material={wallMat()}
          geometry={panelSliceGeo(sideW, WALL_HEIGHT, WALL_THICKNESS, 0, sideW / length, 0, 1)}
        />
        <mesh
          position={[lxB, WALL_HEIGHT / 2, lzB]}
          rotation={[0, -rotY, 0]}
          castShadow
          receiveShadow
          material={wallMat()}
          geometry={panelSliceGeo(sideW, WALL_HEIGHT, WALL_THICKNESS, 1 - sideW / length, 1, 0, 1)}
        />
        <mesh
          position={[mid[0], DOORWAY_HEIGHT + lintelH / 2, mid[1]]}
          rotation={[0, -rotY, 0]}
          castShadow
          receiveShadow
          material={wallMat()}
          geometry={panelSliceGeo(
            lintelW,
            lintelH,
            WALL_THICKNESS,
            sideW / length,
            1 - sideW / length,
            DOORWAY_HEIGHT / WALL_HEIGHT,
            1
          )}
        />

        {/* stone reveals: only the inner faces of the opening */}
        <mesh position={[jxL, sideH / 2, jzL]} rotation={[0, -rotY, 0]} castShadow receiveShadow material={doorMat()}>
          <boxGeometry args={[jambT, sideH, jambD]} />
        </mesh>
        <mesh position={[jxR, sideH / 2, jzR]} rotation={[0, -rotY, 0]} castShadow receiveShadow material={doorMat()}>
          <boxGeometry args={[jambT, sideH, jambD]} />
        </mesh>
        <mesh position={[mid[0], DOORWAY_HEIGHT - jambT / 2, mid[1]]} rotation={[0, -rotY, 0]} castShadow receiveShadow material={doorMat()}>
          <boxGeometry args={[DOORWAY_WIDTH, jambT, jambD]} />
        </mesh>
      </group>
    </RigidBody>
  );
}

// Ceiling slab with PLANAR (per-hex local) UVs — the coffer pattern repeats per
// hex, so local UV is fine here. Built once, shared.
let _ceilSlabGeo: THREE.CylinderGeometry | null = null;
function ceilSlabGeo() {
  if (_ceilSlabGeo) return _ceilSlabGeo;
  const g = new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, 0.1, 6, 1);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const s = 1 / HEX_RADIUS;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * s * 0.5 + 0.5, pos.getZ(i) * s * 0.5 + 0.5);
  }
  uv.needsUpdate = true;
  _ceilSlabGeo = g;
  return g;
}

// World meters spanned by one floor-texture tile. Flagstone UVs are derived
// from WORLD x/z (vertex local + hex world offset) so the stone pattern is
// continuous across hex boundaries — no seam at the doorways.
const FLOOR_TILE = 6;

// Floor slab whose cap UVs are biased by the hex's world offset (ox,oz), so the
// tiled flagstone texture lines up seamlessly between neighbouring hexes. Geo is
// tiny (a 6-gon cap); cached per rounded world position so panning the grid
// reuses geometry instead of reallocating every hex every frame.
const _floorGeoCache = new Map<string, THREE.CylinderGeometry>();
function floorSlabGeo(ox: number, oz: number) {
  const key = `${Math.round(ox * 100)},${Math.round(oz * 100)}`;
  const hit = _floorGeoCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, 0.1, 6, 1);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + ox; // world x of this vertex
    const wz = pos.getZ(i) + oz; // world z
    uv.setXY(i, wx / FLOOR_TILE, wz / FLOOR_TILE);
  }
  uv.needsUpdate = true;
  _floorGeoCache.set(key, g);
  return g;
}

export function HexRoom({ tq, tr, ox = 0, oz = 0 }: { tq: bigint; tr: bigint; ox?: number; oz?: number }) {
  const walls = hexWalls();
  // Per-wall door state from the flower tiling (both neighbours agree). True BigInt coord.
  const doors = walls.map((w) => isDoorBig(tq, tr, w.index));
  // A door edge is shared by two ring hexes that BOTH draw it -> the two coplanar
  // DoorWalls z-fight (ghosting at grazing angles). Dedupe: only the "owner" hex
  // of the shared edge renders it. Owner = lower (q, then r). The non-owner skips
  // it (the passage is open anyway). Solid walls face a sealed centre that draws
  // nothing, so they're never double-drawn and need no dedupe.
  const ownsDoor = walls.map((w) => {
    if (!doors[w.index]) return false;
    const [nq, nr] = neighborOfBig(tq, tr, w.index);
    return tq < nq || (tq === nq && tr < nr);
  });
  // Stable seed for this hex's shelf look, from the low bits of the true coord.
  const seed = Number(((tq * 999n + tr * 17n) % 1000003n + 1000003n) % 1000003n) + 1;

  return (
    <group>
      {/* Floor: visible hex mesh + an explicit flat collider slab whose top sits at y=0. */}
      {/* No <Edges> here: the dark hex outline was the faint seam between floors.
          The continuous flagstone UVs already hide the boundary. */}
      <mesh position={[0, -0.05, 0]} receiveShadow material={floorMat()} geometry={floorSlabGeo(ox, oz)} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[HEX_RADIUS, 0.5, HEX_RADIUS]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Ceiling */}
      <mesh position={[0, WALL_HEIGHT, 0]} material={ceilMat()} geometry={ceilSlabGeo()}>
        <Edges threshold={15} color="#15100a" />
      </mesh>

      {/* Walls: solid (always drawn) or doorway (drawn once, by the owner hex) */}
      {walls.map((w) =>
        doors[w.index] ? (
          ownsDoor[w.index] ? (
            <DoorWall key={w.index} mid={w.mid} length={w.length} rotY={w.rotY} />
          ) : null
        ) : (
          <SolidWall key={w.index} mid={w.mid} length={w.length} rotY={w.rotY} />
        )
      )}

      {/* Bookshelves on the solid walls (+ a collider slab so you can't walk into the books) */}
      {walls
        .filter((w) => !doors[w.index])
        .map((w) => {
          const dist = Math.hypot(w.mid[0], w.mid[1]);
          const nx = w.mid[0] / dist;
          const nz = w.mid[1] / dist;
          const inset = 0.28; // how far the shelf face stands off the wall
          const cx = w.mid[0] - nx * inset;
          const cz = w.mid[1] - nz * inset;
          return (
            <group key={`shelf-${w.index}`}>
              <Bookshelf mid={w.mid} rotY={w.rotY} length={w.length} seed={seed + w.index} tq={tq} tr={tr} wall={w.index} />
              <RigidBody type="fixed" colliders={false}>
                <CuboidCollider
                  args={[w.length / 2, WALL_HEIGHT / 2, 0.18]}
                  position={[cx, WALL_HEIGHT / 2, cz]}
                  rotation={[0, -w.rotY, 0]}
                />
              </RigidBody>
            </group>
          );
        })}
    </group>
  );
}
