"use client";

import dynamic from "next/dynamic";

// R3F must run client-side only.
const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), {
  ssr: false,
});
const BookOverlay = dynamic(() => import("@/components/BookOverlay").then((m) => m.BookOverlay), {
  ssr: false,
});
const StartHint = dynamic(() => import("@/components/BookOverlay").then((m) => m.StartHint), {
  ssr: false,
});
const FlyingVeil = dynamic(() => import("@/components/BookOverlay").then((m) => m.FlyingVeil), {
  ssr: false,
});
const SearchBar = dynamic(() => import("@/components/SearchBar").then((m) => m.SearchBar), {
  ssr: false,
});
const FlyButton = dynamic(() => import("@/components/BookOverlay").then((m) => m.FlyButton), {
  ssr: false,
});
const NetSync = dynamic(() => import("@/components/NetSync").then((m) => m.NetSync), {
  ssr: false,
});
const ChatOverlay = dynamic(() => import("@/components/ChatOverlay").then((m) => m.ChatOverlay), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="fixed inset-0 h-screen w-screen overflow-hidden bg-black">
      <Scene />

      {/* crosshair */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />

      {/* controls hint */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-[11px] tracking-[0.2em] text-white/35">
        WASD WALK · MOUSE LOOK · SPACE JUMP · SHIFT RUN · CLICK A BOOK · / SEARCH · ENTER CHAT · ESC RELEASE
      </div>

      <StartHint />
      <FlyingVeil />
      <SearchBar />
      <FlyButton />
      <BookOverlay />

      {/* multiplayer */}
      <NetSync />
      <ChatOverlay />
    </main>
  );
}
