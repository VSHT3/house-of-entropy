"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Edges } from "@react-three/drei";
import { hexWalls, HEX_RADIUS, WALL_HEIGHT, WALL_THICKNESS, DOORWAY_WIDTH, DOORWAY_HEIGHT, isDoorBig } from "@/lib/babel";
import { Bookshelf } from "./Bookshelf";

// A single solid wall segment (full height, no door).
function SolidWall({ mid, length, rotY }: { mid: [number, number]; length: number; rotY: number }) {
  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh position={[mid[0], WALL_HEIGHT / 2, mid[1]]} rotation={[0, -rotY, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#6b5d4f" roughness={0.9} />
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

  return (
    <RigidBody type="fixed" colliders="cuboid">
      <group>
        <mesh position={[lxA, WALL_HEIGHT / 2, lzA]} rotation={[0, -rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[sideW, WALL_HEIGHT, WALL_THICKNESS]} />
          <meshStandardMaterial color="#6b5d4f" roughness={0.9} />
        </mesh>
        <mesh position={[lxB, WALL_HEIGHT / 2, lzB]} rotation={[0, -rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[sideW, WALL_HEIGHT, WALL_THICKNESS]} />
          <meshStandardMaterial color="#6b5d4f" roughness={0.9} />
        </mesh>
        <mesh position={[mid[0], DOORWAY_HEIGHT + lintelH / 2, mid[1]]} rotation={[0, -rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[DOORWAY_WIDTH, lintelH, WALL_THICKNESS]} />
          <meshStandardMaterial color="#6b5d4f" roughness={0.9} />
        </mesh>
      </group>
    </RigidBody>
  );
}

export function HexRoom({ tq, tr }: { tq: bigint; tr: bigint }) {
  const walls = hexWalls();
  // Per-wall door state from the flower tiling (both neighbours agree). True BigInt coord.
  const doors = walls.map((w) => isDoorBig(tq, tr, w.index));
  // Stable seed for this hex's shelf look, from the low bits of the true coord.
  const seed = Number(((tq * 999n + tr * 17n) % 1000003n + 1000003n) % 1000003n) + 1;

  return (
    <group>
      {/* Floor: visible hex mesh + an explicit flat collider slab whose top sits at y=0. */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[HEX_RADIUS, HEX_RADIUS, 0.1, 6, 1]} />
        <meshStandardMaterial color="#8a7a5c" roughness={0.85} />
        <Edges threshold={15} color="#15100a" />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[HEX_RADIUS, 0.5, HEX_RADIUS]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Ceiling */}
      <mesh position={[0, WALL_HEIGHT, 0]}>
        <cylinderGeometry args={[HEX_RADIUS, HEX_RADIUS, 0.1, 6, 1]} />
        <meshStandardMaterial color="#4a4036" roughness={1} />
        <Edges threshold={15} color="#15100a" />
      </mesh>

      {/* Walls: doorway or solid per the shared-edge hash */}
      {walls.map((w) =>
        doors[w.index] ? (
          <DoorWall key={w.index} mid={w.mid} length={w.length} rotY={w.rotY} />
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
