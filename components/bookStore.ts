"use client";

import { useSyncExternalStore } from "react";
import type { PageCoordBig, SearchResult } from "@/lib/library";
import { addrHexToCoordBig } from "@/lib/library";
import { isCenterBig } from "@/lib/babel";
import { setOrigin } from "./worldStore";
import { playPageTurn, setAmbienceDucked } from "@/lib/audio";

// Where (local hex) the player should be teleported to after a search arrival, and a nonce
// so <Player> fires the teleport once. We pick origin so the found hex is at a known local
// slot, then choose a guaranteed ring (non-centre) local hex to stand in.
export let arrival: { nonce: number; lq: number; lr: number } = { nonce: 0, lq: 0, lr: 0 };

// Two kinds of "open book":
//  - a real shelf book at a (BigInt) PageCoord
//  - a search result (arbitrary page text)
type OpenState =
  | { kind: "coord"; coord: PageCoordBig }
  // A search opens the book that contains the manufactured page. `coord` is that page's real
  // (recovered) coordinate so arrow keys can flip through the rest of the book; `homePage` is
  // the page index where the query actually lives (highlight only shows there).
  | { kind: "search"; result: SearchResult; coord: PageCoordBig; homePage: number }
  | null;

let current: OpenState = null;
let flying = false; // true during the search "flythrough" travel animation
let freeFly = false; // noclip free-fly: detach gravity/collision, roam the camera with WASD+QE
let menuOpen = false; // the Esc menu (help / change name / players) is up
let searchOpen = false; // the "/" search box is up (so Esc closes it, not opens the menu)
let pending: SearchResult | null = null; // result to reveal when the flythrough ends
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export let tutorialSeen = false;

export function openBook(coord: PageCoordBig) {
  current = { kind: "coord", coord: { ...coord, page: 0 } };
  tutorialSeen = true;
  setAmbienceDucked(true);
  emit();
}

export function closeBook() {
  current = null;
  setAmbienceDucked(false);
  emit();
}

export function turnPage(delta: number) {
  if (!current) return;
  if (current.kind === "coord") {
    const page = Math.max(0, Math.min(409, current.coord.page + delta));
    if (page !== current.coord.page) playPageTurn();
    current = { kind: "coord", coord: { ...current.coord, page } };
    emit();
  } else if (current.kind === "search") {
    // Flip through the book the search landed in; OpenBook regenerates each page from coord.
    const page = Math.max(0, Math.min(409, current.coord.page + delta));
    if (page !== current.coord.page) playPageTurn();
    current = { ...current, coord: { ...current.coord, page } };
    emit();
  }
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
    // c includes the real page index where the query lives; open the book there so arrow keys
    // can flip the rest of the book and we know which page carries the highlight.
    current = { kind: "search", result: pending, coord: c, homePage: c.page };
  }
  pending = null;
  tutorialSeen = true;
  emit();
}

export function isFlying(): boolean {
  return flying;
}

// --- free-fly (noclip) ------------------------------------------------------

// Toggle noclip free-fly. Closing a book stays independent; we just flip the flag and let
// <Player> swap to fly physics. No-op while a search flythrough is mid-animation.
export function toggleFreeFly() {
  if (flying) return;
  freeFly = !freeFly;
  emit();
}

export function isFreeFly(): boolean {
  return freeFly;
}

// --- Esc menu (help / change name / players) --------------------------------
export function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
  emit();
}
export function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  emit();
}
export function isMenuOpen(): boolean {
  return menuOpen;
}
export function useMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, () => menuOpen, () => menuOpen);
}
export function setSearchOpen(v: boolean) {
  searchOpen = v;
}
export function isSearchOpen(): boolean {
  return searchOpen;
}

// --- reads ------------------------------------------------------------------

export function isBookOpen(): boolean {
  return current !== null;
}
// Movement/look are locked while a book is open, we're flying, or the menu is up.
export function isInputLocked(): boolean {
  return current !== null || flying || menuOpen;
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

export function useFreeFly(): boolean {
  return useSyncExternalStore(subscribe, () => freeFly, () => freeFly);
}

export function useArrival() {
  return useSyncExternalStore(subscribe, () => arrival, () => arrival);
}
