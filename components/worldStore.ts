"use client";

import { useSyncExternalStore } from "react";

// Floating origin: the BigInt hex coordinate that local hex (0,0) currently maps to.
// Rendering uses small local coords near 0; true content coords = origin + local.
let originQ = 0n;
let originR = 0n;
const listeners = new Set<() => void>();
let snapshot = { q: 0n, r: 0n };

function emit() {
  snapshot = { q: originQ, r: originR };
  for (const l of listeners) l();
}

export function setOrigin(q: bigint, r: bigint) {
  originQ = q;
  originR = r;
  emit();
}

export function getOrigin(): { q: bigint; r: bigint } {
  return snapshot;
}

// true coord = origin + local
export function trueCoord(lq: number, lr: number): { q: bigint; r: bigint } {
  return { q: originQ + BigInt(lq), r: originR + BigInt(lr) };
}

export function useOrigin() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot
  );
}
