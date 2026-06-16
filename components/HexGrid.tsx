"use client";

import { useState, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { HexRoom } from "./HexRoom";
import { hexToWorld, neighborOf, isCenterBig, HEX_STEP } from "@/lib/babel";
import { playerPos } from "./playerState";
import { trueCoord, useOrigin } from "./worldStore";

const RING = 2; // rooms kept live around the player (fog at ~20 hides the edge)

type Key = string;
const keyOf = (q: number, r: number): Key => `${q},${r}`;

// All hexes within `ring` steps of (cq,cr), via the 6-neighbour walk (BFS over the lattice).
function hexesInRange(cq: number, cr: number, ring: number): [number, number][] {
  const seen = new Set<Key>();
  const out: [number, number][] = [];
  let frontier: [number, number][] = [[cq, cr]];
  seen.add(keyOf(cq, cr));
  out.push([cq, cr]);
  for (let d = 0; d < ring; d++) {
    const next: [number, number][] = [];
    for (const [q, r] of frontier) {
      for (let w = 0; w < 6; w++) {
        const [nq, nr] = neighborOf(q, r, w);
        const k = keyOf(nq, nr);
        if (!seen.has(k)) {
          seen.add(k);
          out.push([nq, nr]);
          next.push([nq, nr]);
        }
      }
    }
    frontier = next;
  }
  return out;
}

// Nearest hex (q,r) to a world (x,z) — invert the axial basis, round in cube space.
function worldToHex(x: number, z: number): [number, number] {
  // basis from hexToWorld: solve [B0 B1] * [q r]^T = [x z]^T
  const [b0x, b0z] = hexToWorld(1, 0);
  const [b1x, b1z] = hexToWorld(0, 1);
  const det = b0x * b1z - b1x * b0z;
  const qf = (x * b1z - z * b1x) / det;
  const rf = (b0x * z - b0z * x) / det;
  // cube rounding for hex grids
  const sf = -qf - rf;
  let rq = Math.round(qf), rr = Math.round(rf), rs = Math.round(sf);
  const dq = Math.abs(rq - qf), dr = Math.abs(rr - rf), ds = Math.abs(rs - sf);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

export function HexGrid() {
  const [center, setCenter] = useState<[number, number]>([0, 0]);
  const lastKey = useRef<Key>("0,0");
  const origin = useOrigin(); // re-render the grid when we rebase to a far region

  useFrame(() => {
    const [hq, hr] = worldToHex(playerPos.x, playerPos.z);
    const k = keyOf(hq, hr);
    if (k !== lastKey.current) {
      lastKey.current = k;
      setCenter([hq, hr]);
    }
  });

  const live = hexesInRange(center[0], center[1], RING);

  return (
    <>
      {live.map(([lq, lr]) => {
        // true (BigInt) coordinate decides content; local coord decides where it renders
        const t = trueCoord(lq, lr);
        if (isCenterBig(t.q, t.r)) return null; // sealed spacer hexes are never rendered/entered
        const [x, z] = hexToWorld(lq, lr);
        return (
          <group key={`${origin.q},${origin.r}:${keyOf(lq, lr)}`} position={[x, 0, z]}>
            {/* pass world offset so the floor's flagstone UVs are continuous across hexes */}
            <HexRoom tq={t.q} tr={t.r} ox={x} oz={z} />
          </group>
        );
      })}
    </>
  );
}

export { HEX_STEP };
