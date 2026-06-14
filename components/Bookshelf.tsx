"use client";

import { useMemo, useRef, useLayoutEffect } from "react";
import * as THREE from "three";
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

// Warm, faded leather/paper palette for spines.
const SPINE_COLORS = ["#7b3f2a", "#8a6d3b", "#5c4332", "#6e5a3c", "#894f3a", "#4a5240", "#82724f", "#5a3b2e"];

const SHELF_BOTTOM = 0.35; // lowest shelf board height
const SHELF_TOP = WALL_HEIGHT - 0.45; // highest reachable
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
    let i = 0;
    for (let row = 0; row < SHELVES_PER_WALL; row++) {
      const y = rowYs[row] + 0.0;
      for (let b = 0; b < BOOKS_PER_SHELF; b++) {
        const h = hash01(seed * 1000 + row * 50 + b);
        const h2 = hash01(seed * 2000 + row * 50 + b);
        const tut = isTutorialBook({ q: tq, r: tr, wall, shelf: row, book: b });
        const bookH = tut ? 0.42 : 0.26 + h * 0.12; // tutorial book is taller
        const bookW = tut ? slotW * 1.0 : slotW * (0.7 + h2 * 0.25);
        // local position along the wall: x = left->right, y up, z = book depth (out of wall)
        const lx = -usableW / 2 + slotW * (b + 0.5);
        dummy.position.set(lx, y + bookH / 2, tut ? 0.03 : 0); // tutorial sticks out a touch
        dummy.scale.set(bookW, bookH, tut ? BOOK_DEPTH * 1.15 : BOOK_DEPTH);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const c = tut
          ? new THREE.Color("#d9b44a") // distinct warm gold spine
          : new THREE.Color(SPINE_COLORS[Math.floor(hash01(seed * 7 + row * 9 + b) * SPINE_COLORS.length)]);
        baseColors.current[i] = c.clone();
        mesh.setColorAt(i, c);
        i++;
      }
    }
    hovered.current = null;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [rowYs, slotW, usableW, seed]);

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
          <mesh key={row} position={[0, y, 0]}>
            <boxGeometry args={[usableW + 0.1, BOARD_THICK, BOOK_DEPTH + 0.06]} />
            <meshStandardMaterial color="#3b2c1d" roughness={0.95} />
          </mesh>
        ))}
        {/* instanced book spines */}
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, count]}
          castShadow
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (e.instanceId == null) return;
            e.stopPropagation();
            const shelf = Math.floor(e.instanceId / BOOKS_PER_SHELF);
            const book = e.instanceId % BOOKS_PER_SHELF;
            openBook({ q: tq, r: tr, wall, shelf, book, page: 0 });
          }}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            highlight(e.instanceId ?? null);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            highlight(null);
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial roughness={0.8} toneMapped={false} />
        </instancedMesh>
      </group>
    </group>
  );
}
