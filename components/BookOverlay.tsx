"use client";

import { useState, useEffect } from "react";
import { useOpenState, useFlying, useFreeFly, toggleFreeFly, closeBook, turnPage, tutorialSeen } from "./bookStore";
import { addrToCoordString } from "@/lib/library";

// Copy with a fallback for non-secure contexts (plain HTTP, e.g. a self-hosted deploy):
// navigator.clipboard is undefined off HTTPS/localhost, so fall back to a hidden textarea +
// execCommand. Returns whether the copy appears to have succeeded.
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
        The halls go on without end. A <span className="font-semibold text-amber-300">golden book</span> waits ahead — open it to begin.
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

// Top-right toggle for noclip free-fly. Mirrors the F key. Hidden while a book is open so it
// doesn't overlap the reading UI. pointer-events-auto so it's clickable through the overlay.
export function FlyButton() {
  const open = useOpenState();
  const freeFly = useFreeFly();
  if (open) return null;
  return (
    <button
      onClick={() => toggleFreeFly()}
      className={`pointer-events-auto absolute right-4 top-4 rounded px-3 py-1.5 text-xs tracking-wider backdrop-blur-sm transition-colors ${
        freeFly
          ? "bg-amber-300/90 text-black hover:bg-amber-200"
          : "bg-white/10 text-white/80 hover:bg-white/20"
      }`}
      title="Toggle noclip free-fly (F). Space/Ctrl = up/down, Shift = boost."
    >
      {freeFly ? "✈ flying (F)" : "fly (F)"}
    </button>
  );
}

// DOM overlay shown while a book is open: coordinate / address readout + nav + close.
export function BookOverlay() {
  const open = useOpenState();
  const [copied, setCopied] = useState<string | null>(null);
  if (!open) return null;

  const doCopy = async (key: string, text: string) => {
    const ok = await copy(text);
    setCopied(ok ? key : `${key}-fail`);
    setTimeout(() => setCopied((c) => (c === key || c === `${key}-fail` ? null : c)), 1400);
  };
  const label = (key: string, base: string) =>
    copied === key ? "copied!" : copied === `${key}-fail` ? "copy failed" : base;

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
            found “{open.result.query}” · {addrToCoordString(open.result.addrHex)} · page {open.coord.page + 1}/410
          </>
        )}
      </div>
      <div className="pointer-events-auto flex items-center gap-2 text-xs">
        <button onClick={() => turnPage(-2)} className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20">
          ← prev
        </button>
        <button onClick={() => turnPage(2)} className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20">
          next →
        </button>
        {open.kind === "search" && (
          <>
            <button
              onClick={() => doCopy("addr", "0x" + open.result.addrHex)}
              className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20"
            >
              {label("addr", "copy address")}
            </button>
            <button
              onClick={() => doCopy("coords", addrToCoordString(open.result.addrHex))}
              className="rounded bg-white/10 px-3 py-1.5 text-white/80 hover:bg-white/20"
            >
              {label("coords", "copy coords")}
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
