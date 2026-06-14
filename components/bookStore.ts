"use client";

import { useSyncExternalStore } from "react";
import type { PageCoordBig, SearchResult } from "@/lib/library";
import { addrHexToCoordBig } from "@/lib/library";
import { isCenterBig } from "@/lib/babel";
import { setOrigin } from "./worldStore";

// Where (local hex) the player should be teleported to after a search arrival, and a nonce
// so <Player> fires the teleport once. We pick origin so the found hex is at a known local
// slot, then choose a guaranteed ring (non-centre) local hex to stand in.
export let arrival: { nonce: number; lq: number; lr: number } = { nonce: 0, lq: 0, lr: 0 };

// Two kinds of "open book":
//  - a real shelf book at a (BigInt) PageCoord
//  - a search result (arbitrary page text)
type OpenState =
  | { kind: "coord"; coord: PageCoordBig }
  | { kind: "search"; result: SearchResult }
  | null;

let current: OpenState = null;
let flying = false; // true during the search "flythrough" travel animation
let pending: SearchResult | null = null; // result to reveal when the flythrough ends
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export let tutorialSeen = false;

export function openBook(coord: PageCoordBig) {
  current = { kind: "coord", coord: { ...coord, page: 0 } };
  tutorialSeen = true;
  emit();
}

export function closeBook() {
  current = null;
  emit();
}

export function turnPage(delta: number) {
  if (!current || current.kind !== "coord") return;
  const page = Math.max(0, Math.min(409, current.coord.page + delta));
  current = { kind: "coord", coord: { ...current.coord, page } };
  emit();
}

// --- search flythrough ------------------------------------------------------

// Begin the travel animation; the pending result is revealed by finishFlythrough(),
// which the <FlyThrough> component calls when the camera rush completes.
export function startFlythrough(result: SearchResult) {
  pending = result;
  flying = true;
  current = null; // close any open book while travelling
  emit();
}

export function finishFlythrough() {
  flying = false;
  if (pending) {
    // Rebase the world onto the found hex so the player has physically arrived: the found
    // coordinate becomes local (0,0). Then pick a guaranteed ring (non-centre) local hex to
    // stand in, and tell <Player> to teleport there (origin + local = a real room).
    const c = addrHexToCoordBig(pending.addrHex);
    setOrigin(c.q, c.r);
    let lq = 0, lr = 0;
    // spiral out from (0,0) until we hit a non-centre local hex (origin+local)
    const cand: [number, number][] = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, -1], [-1, 1], [2, 0], [0, 2],
    ];
    for (const [q, r] of cand) {
      if (!isCenterBig(c.q + BigInt(q), c.r + BigInt(r))) {
        lq = q;
        lr = r;
        break;
      }
    }
    arrival = { nonce: arrival.nonce + 1, lq, lr };
    current = { kind: "search", result: pending };
  }
  pending = null;
  tutorialSeen = true;
  emit();
}

export function isFlying(): boolean {
  return flying;
}

// --- reads ------------------------------------------------------------------

export function isBookOpen(): boolean {
  return current !== null;
}
// Movement/look are locked while a book is open OR we're flying.
export function isInputLocked(): boolean {
  return current !== null || flying;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useOpenState(): OpenState {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function useFlying(): boolean {
  return useSyncExternalStore(subscribe, () => flying, () => flying);
}

export function useArrival() {
  return useSyncExternalStore(subscribe, () => arrival, () => arrival);
}
