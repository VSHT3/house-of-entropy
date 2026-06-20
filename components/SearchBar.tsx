"use client";

import { useEffect, useRef, useState } from "react";
import { containsSearch, containsSearchWords, pageFromAddrHex } from "@/lib/library";
import { startFlythrough, isInputLocked, setSearchOpen } from "./bookStore";

// Press "/" to open a search box. Type any text; on Enter we find a page in the library
// that contains it and fly there. Releases pointer lock while open.
export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [wordsMode, setWordsMode] = useState(false); // false = noise, true = english words
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !open && !isInputLocked()) {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        setValue("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Mirror open state into the store so the Esc menu knows not to open over the search box.
  useEffect(() => {
    setSearchOpen(open);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submit = () => {
    // a "0x…" entry is treated as a raw address to travel to; anything else is text search.
    // Only trim for the address test — the search text keeps its leading/trailing spaces.
    const trimmed = value.trim();
    const res = /^0x[0-9a-f]+$/i.test(trimmed)
      ? pageFromAddrHex(trimmed)
      : wordsMode
      ? containsSearchWords(value)
      : containsSearch(value);
    setOpen(false);
    setValue("");
    if (res) startFlythrough(res);
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/3 w-[28rem] max-w-[90vw] -translate-x-1/2">
      <div className="rounded-lg border border-white/15 bg-black/70 p-4 backdrop-blur">
        <div className="mb-2 text-xs tracking-widest text-white/50">SEARCH THE LIBRARY</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            e.stopPropagation();
          }}
          placeholder="type words to find — or paste a 0x… address"
          className="w-full rounded bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/30"
        />
        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/50">
          <span>surround with:</span>
          <button
            onClick={() => setWordsMode(false)}
            className={`rounded px-2 py-1 ${!wordsMode ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"}`}
          >
            noise
          </button>
          <button
            onClick={() => setWordsMode(true)}
            className={`rounded px-2 py-1 ${wordsMode ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"}`}
          >
            english words
          </button>
        </div>
        <div className="mt-2 text-[11px] text-white/40">enter to find &amp; travel · esc to cancel</div>
      </div>
    </div>
  );
}
