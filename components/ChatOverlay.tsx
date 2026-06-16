"use client";

// DOM overlay for multiplayer identity + chat. A first-visit name prompt, a corner chat log,
// and an input opened with Enter. While the input is focused, setChatFocused(true) tells
// Player.tsx to ignore movement keys so typing doesn't drive the avatar.

import { useEffect, useRef, useState } from "react";
import { useChat, useMyId, setName, sendChat, setChatFocused } from "@/lib/net";
import { isInputLocked } from "./bookStore";

function NamePrompt({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = () => {
    const v = value.trim().slice(0, 24);
    if (!v) return;
    localStorage.setItem("hoe-name", v);
    setName(v);
    onDone();
  };
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/3 w-[24rem] max-w-[90vw] -translate-x-1/2">
      <div className="rounded-lg border border-white/15 bg-black/70 p-4 backdrop-blur">
        <div className="mb-2 text-xs tracking-widest text-white/50">YOUR NAME IN THE LIBRARY</div>
        <input
          ref={ref}
          value={value}
          maxLength={24}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            e.stopPropagation();
          }}
          placeholder="a name other wanderers will see"
          className="w-full rounded bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/30"
        />
        <div className="mt-2 text-[11px] text-white/40">enter to confirm</div>
      </div>
    </div>
  );
}

export function ChatOverlay() {
  const chat = useChat();
  const myId = useMyId();
  const [named, setNamed] = useState(true); // assume named until we know otherwise
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // On first load, prompt for a name unless one is stored.
  useEffect(() => {
    const stored = localStorage.getItem("hoe-name");
    setNamed(!!stored);
  }, []);

  // Enter opens the chat input (when not reading/searching); Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing) return;
      if (e.key === "Enter" && !isInputLocked() && named) {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        setTyping(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, named]);

  useEffect(() => {
    setChatFocused(typing);
    if (typing) inputRef.current?.focus();
    return () => setChatFocused(false);
  }, [typing]);

  // keep log scrolled to newest
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat]);

  if (!named) return <NamePrompt onDone={() => setNamed(true)} />;

  const send = () => {
    sendChat(draft);
    setDraft("");
    setTyping(false);
  };

  return (
    <div className="absolute bottom-16 left-4 w-[22rem] max-w-[80vw] font-mono">
      <div
        ref={logRef}
        className="pointer-events-none mb-1 max-h-40 overflow-y-auto text-[12px] leading-relaxed"
      >
        {chat.map((line, i) => (
          <div key={i} className="text-white/70">
            <span className="text-amber-300/80">{line.name || line.id}</span>
            <span className="text-white/40">: </span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
      {typing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={280}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            else if (e.key === "Escape") {
              setDraft("");
              setTyping(false);
            }
            e.stopPropagation();
          }}
          placeholder="say something…"
          className="pointer-events-auto w-full rounded bg-black/70 px-3 py-1.5 text-sm text-white outline-none backdrop-blur placeholder:text-white/30"
        />
      ) : (
        <div className="pointer-events-none text-[11px] tracking-wider text-white/30">
          {myId ? "press enter to chat" : "connecting…"}
        </div>
      )}
    </div>
  );
}
