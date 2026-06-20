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
const NetSync = dynamic(() => import("@/components/NetSync").then((m) => m.NetSync), {
  ssr: false,
});
const ChatOverlay = dynamic(() => import("@/components/ChatOverlay").then((m) => m.ChatOverlay), {
  ssr: false,
});
const Menu = dynamic(() => import("@/components/Menu").then((m) => m.Menu), {
  ssr: false,
});
const Roster = dynamic(() => import("@/components/Menu").then((m) => m.Roster), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="fixed inset-0 h-screen w-screen overflow-hidden bg-black">
      <Scene />

      {/* crosshair */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />

      {/* one faint hint — full controls live in the Esc menu */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-[11px] tracking-[0.2em] text-white/30">
        ESC MENU · HOLD TAB FOR READERS · / SEARCH
      </div>

      <StartHint />
      <FlyingVeil />
      <SearchBar />
      <BookOverlay />

      {/* menu + roster */}
      <Menu />
      <Roster />

      {/* multiplayer */}
      <NetSync />
      <ChatOverlay />
    </main>
  );
}
