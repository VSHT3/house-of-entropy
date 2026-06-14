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

export default function Home() {
  return (
    <main className="fixed inset-0 h-screen w-screen overflow-hidden bg-black">
      <Scene />

      {/* crosshair */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />

      {/* controls hint */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-xs tracking-widest text-white/40">
        CLICK TO ENTER · WASD MOVE · MOUSE LOOK · CLICK A BOOK TO READ · ESC RELEASE
      </div>

      <StartHint />
      <FlyingVeil />
      <SearchBar />
      <BookOverlay />
    </main>
  );
}
