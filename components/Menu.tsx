"use client";

// Two pause/HUD overlays mounted at page level (outside the Canvas):
//  - <Menu/>      : Esc (when nothing else is open) opens a panel with help, a name field,
//                   and the live player list. Esc again resumes. Pointer is released while up.
//  - <Roster/>    : hold Tab to see active readers with their hex coord + distance from you.
//
// Both read multiplayer state from lib/net and the floating origin from worldStore.

import { useEffect, useRef, useState } from "react";
import {
  isBookOpen,
  isFlying,
  isMenuOpen,
  isSearchOpen,
  openMenu,
  closeMenu,
  useMenuOpen,
} from "./bookStore";
import {
  getMyName,
  isConnected,
  setName,
  useMyId,
  useRoster,
} from "@/lib/net";
import { getOrigin } from "./worldStore";
import { playerPos } from "./playerState";
import { worldToHex } from "@/lib/babel";

// Compact base-36 head…tail of a BigInt hex component, like the book readout.
function shortHex(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString(36);
  const body = s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  return (neg ? "-" : "") + body;
}

// Axial hex distance between two BigInt coords (cube distance). Returns null when the
// magnitude blows past safe Number range — that peer is in a "far region".
const FAR = 1_000_000_000n;
function hexDist(aq: bigint, ar: bigint, bq: bigint, br: bigint): number | null {
  const dq = aq - bq;
  const dr = ar - br;
  if (dq > FAR || dq < -FAR || dr > FAR || dr < -FAR) return null;
  const q = Number(dq);
  const r = Number(dr);
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

// My own current true hex coord, derived from local player pos + the floating origin.
function myTrueHex(): { q: bigint; r: bigint } {
  const [lq, lr] = worldToHex(playerPos.x, playerPos.z);
  const o = getOrigin();
  return { q: o.q + BigInt(lq), r: o.r + BigInt(lr) };
}

function distLabel(d: number | null): string {
  if (d === null) return "far region";
  if (d === 0) return "here";
  return `${d} hex${d === 1 ? "" : "es"}`;
}

// ---------------------------------------------------------------------------
// Esc menu
// ---------------------------------------------------------------------------
export function Menu() {
  const menuOpen = useMenuOpen();
  const roster = useRoster(); // reactive: re-renders as peers come & go
  const myId = useMyId();
  const [name, setNameInput] = useState("");

  // Esc toggles the menu, but only when no book/search/flythrough owns Esc already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isMenuOpen()) {
        closeMenu();
        return;
      }
      // Let the book overlay / search box keep Esc when they're up.
      if (isBookOpen() || isFlying() || isSearchOpen()) return;
      e.preventDefault();
      openMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Seed the name field from storage whenever the menu opens.
  useEffect(() => {
    if (menuOpen) setNameInput(getMyName());
  }, [menuOpen]);

  if (!menuOpen) return null;

  const me = myTrueHex();

  const commitName = () => {
    const n = name.trim().slice(0, 24);
    if (n) setName(n);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="w-[26rem] max-w-[92vw] rounded-xl border border-white/15 bg-[#16120c]/95 p-6 text-amber-50/90 shadow-2xl">
        <div className="mb-4 text-center text-sm tracking-[0.35em] text-amber-200/80">
          HOUSE OF ENTROPY
        </div>

        {/* name */}
        <label className="mb-1 block text-[11px] uppercase tracking-widest text-amber-200/50">
          your name
        </label>
        <div className="mb-5 flex gap-2">
          <input
            value={name}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitName();
            }}
            maxLength={24}
            placeholder="anonymous reader"
            className="flex-1 rounded bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/25"
          />
          <button
            onClick={commitName}
            className="rounded bg-amber-300/90 px-3 py-2 text-xs font-semibold tracking-wider text-black hover:bg-amber-200"
          >
            save
          </button>
        </div>

        {/* controls */}
        <div className="mb-5">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-amber-200/50">controls</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] text-amber-50/75">
            <span>WASD</span><span className="text-amber-50/50">walk</span>
            <span>mouse</span><span className="text-amber-50/50">look</span>
            <span>space</span><span className="text-amber-50/50">jump</span>
            <span>shift</span><span className="text-amber-50/50">run</span>
            <span>click a book</span><span className="text-amber-50/50">read it</span>
            <span>arrows</span><span className="text-amber-50/50">turn pages</span>
            <span>/</span><span className="text-amber-50/50">search the stacks</span>
            <span>enter</span><span className="text-amber-50/50">speak aloud</span>
            <span>F</span><span className="text-amber-50/50">free-fly (noclip)</span>
            <span>G</span><span className="text-amber-50/50">snap to corridor</span>
            <span>hold tab</span><span className="text-amber-50/50">who&apos;s here</span>
            <span>esc</span><span className="text-amber-50/50">menu / close</span>
          </div>
        </div>

        {/* players */}
        <div className="mb-5">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-amber-200/50">
            readers here ({roster.length + 1})
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-[12px]">
            <RosterRow name={(getMyName() || "you") + " (you)"} q={me.q} r={me.r} myQ={me.q} myR={me.r} />
            {roster.map((p) => (
              <RosterRow
                key={p.id}
                name={p.name || p.id.slice(0, 6)}
                q={p.tq}
                r={p.tr}
                myQ={me.q}
                myR={me.r}
              />
            ))}
            {roster.length === 0 && (
              <div className="px-2 py-1 text-amber-50/35">
                {isConnected() ? "no other readers here yet" : "not connected to the relay"}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={closeMenu}
          className="w-full rounded bg-white/10 py-2 text-sm tracking-wider text-white/85 hover:bg-white/20"
        >
          resume (esc)
        </button>
        {/* keep myId referenced so the panel refreshes on connect */}
        <span className="hidden">{myId}</span>
      </div>
    </div>
  );
}

function RosterRow({
  name,
  q,
  r,
  myQ,
  myR,
}: {
  name: string;
  q: bigint | null;
  r: bigint | null;
  myQ: bigint;
  myR: bigint;
}) {
  const hasPos = q !== null && r !== null;
  const d = hasPos ? hexDist(q, r, myQ, myR) : null;
  return (
    <div className="flex items-center justify-between gap-3 rounded bg-white/[0.03] px-2 py-1">
      <span className="truncate text-amber-50/90">{name}</span>
      <span className="shrink-0 text-amber-50/45">
        {hasPos ? `${shortHex(q!)},${shortHex(r!)}` : "—"} · {distLabel(d)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab-held roster (lightweight, non-blocking — doesn't release pointer)
// ---------------------------------------------------------------------------
export function Roster() {
  const [show, setShow] = useState(false);
  const roster = useRoster();
  const tickRef = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Tab") return;
      e.preventDefault(); // Tab would otherwise blur the canvas / cycle focus
      e.stopPropagation();
      setShow(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setShow(false);
      }
    };
    // Capture phase so we win Tab before the canvas / any focus handler sees it.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    // Safety: if the window loses focus while Tab is held, the keyup may never arrive.
    const blur = () => setShow(false);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // While held, refresh ~5×/s so distances track movement (positions live outside React).
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => force((tickRef.current = tickRef.current + 1)), 200);
    return () => clearInterval(id);
  }, [show]);

  if (!show) return null;
  const me = myTrueHex();

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/4 w-[24rem] max-w-[90vw] -translate-x-1/2">
      <div className="rounded-lg border border-white/15 bg-black/75 p-4 backdrop-blur">
        <div className="mb-2 text-center text-[11px] tracking-[0.3em] text-amber-200/70">
          READERS ({roster.length + 1})
        </div>
        <div className="space-y-1 font-mono text-[12px]">
          <RosterRow name={(getMyName() || "you") + " (you)"} q={me.q} r={me.r} myQ={me.q} myR={me.r} />
          {roster.map((p) => (
            <RosterRow
              key={p.id}
              name={p.name || p.id.slice(0, 6)}
              q={p.tq}
              r={p.tr}
              myQ={me.q}
              myR={me.r}
            />
          ))}
          {roster.length === 0 && (
            <div className="px-2 py-1 text-center text-amber-50/35">
              {isConnected() ? "no other readers nearby" : "offline — relay not connected"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
