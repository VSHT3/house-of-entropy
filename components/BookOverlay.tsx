"use client";

import { useState, useEffect } from "react";
import { useOpenState, useFlying, closeBook, turnPage, tutorialSeen } from "./bookStore";
import { addrToCoordString } from "@/lib/library";

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// Truncate a possibly-enormous BigInt coordinate for display.
function short(n: bigint): string {
  const s = (n < 0n ? "-" : "") + (n < 0n ? -n : n).toString();
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

// Start hint: nudges the player toward the golden tutorial book. Hides after any book opens.
export function StartHint() {
  const open = useOpenState();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (open || tutorialSeen) setDismissed(true);
  }, [open]);
  if (dismissed) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 text-center">
      <div className="rounded-md bg-black/40 px-4 py-2 text-sm tracking-wide text-amber-200/90 backdrop-blur-sm">
        Look for the <span className="font-semibold text-amber-300">golden book</span> ahead — click it to begin.
      </div>
    </div>
  );
}

// Lightspeed veil shown during the search flythrough: a radial speed-streak vignette.
export function FlyingVeil() {
  const flying = useFlying();
  if (!flying) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 animate-pulse"
        style={{
          background:
            "radial-gradient(circle at center, transparent 18%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,225,170,0.05) 0deg, transparent 2deg, transparent 6deg)",
          maskImage: "radial-gradient(circle at center, transparent 25%, black 70%)",
          WebkitMaskImage: "radial-gradient(circle at center, transparent 25%, black 70%)",
        }}
      />
      <div className="absolute left-1/2 top-[62%] -translate-x-1/2 text-sm tracking-[0.3em] text-amber-100/70">
        TRAVELLING THE STACKS…
      </div>
    </div>
  );
}

// DOM overlay shown while a book is open: coordinate / address readout + nav + close.
export function BookOverlay() {
  const open = useOpenState();
  if (!open) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 pb-6">
      <div className="font-mono text-[11px] tracking-wider text-white/60">
        {open.kind === "coord" ? (
          <>
            hex {short(open.coord.q)},{short(open.coord.r)} · wall {open.coord.wall} · shelf {open.coord.shelf} ·
            book {open.coord.book} · page {open.coord.page + 1}/410
          </>
        ) : (
          <>
            found “{open.result.query}” · {addrToCoordString(open.result.addrHex)}
          </>
        )}
      </div>
      <div className="pointer-events-auto flex items-center gap-2 text-xs">
        {open.kind === "coord" && (
          <>
            <button onClick={() => turnPage(-2)} className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20">
              ← prev
            </button>
            <button onClick={() => turnPage(2)} className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20">
              next →
            </button>
          </>
        )}
        {open.kind === "search" && (
          <>
            <button
              onClick={() => copy("0x" + open.result.addrHex)}
              className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20"
            >
              copy address
            </button>
            <button
              onClick={() => copy(addrToCoordString(open.result.addrHex))}
              className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20"
            >
              copy coords
            </button>
          </>
        )}
        <button onClick={() => closeBook()} className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20">
          close (esc)
        </button>
      </div>
    </div>
  );
}
