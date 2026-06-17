@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**House of Entropy** — a web app that lets users walk Borges' *Library of Babel* in first-person 3D. Faithful Borges architecture (hexagonal rooms, shelves of books), grounded first-person walk, and books whose text is generated on demand from a true reversible coordinate↔text bijection (no storage — every page is computed).

## Commands

```bash
npm run dev      # Next.js dev server (Turbopack) at localhost:3000
npm run build    # production build
npm run lint     # eslint
npx tsc --noEmit # typecheck (do this after edits; there is no test suite)
```

There is no test runner. Correctness of the math (hex grid, page bijection) is verified with throwaway Node scripts in `/tmp` — write a `.mjs` that inlines the function and run `node /tmp/x.mjs`. This is the established pattern for validating geometry/bijection changes before wiring them into the React tree.

## Critical constraints

- **`reactStrictMode: false`** in `next.config.ts` is load-bearing. StrictMode double-mounts effects, which makes R3F create/destroy the WebGL context twice → "THREE.WebGLRenderer: Context Lost" (black screen + sad-face). Do not re-enable it.
- **`tsconfig` target is ES2020** — required for BigInt literals (`0n`) used by the page engine.
- The page engine uses **BigInt over a 4942-digit modulus (35^3200)**. `pageText()` is ~4ms. NEVER call it per-frame — only on user action (clicking a book, flipping a page).
- R3F components are client-only; `Scene` and DOM overlays are imported via `next/dynamic` with `ssr: false`.

## Architecture

Two layers: a pure-math core in `lib/`, and the R3F scene graph in `components/`.

### `lib/babel.ts` — geometry + the hex grid
- Borges constants. **ALPHABET is the single source of truth** for the page engine (`BASE = ALPHABET.length`); it was expanded past the faithful 25 to 35 (full a–z + `space , . ? ! - ; : '`) so search input is typeable. Page is 80×40, book 410 pages.
- Flat-top hexagon vertices/walls; `hexWalls()` gives per-wall midpoint/rotation used to place walls, shelves, and colliders.
- **Hex grid "flower" topology** (subtle): a plain hex grid is not 2-colourable, so you cannot give every hex exactly 3 evenly-spaced doors that line up. Solution: 1/3 of hexes are **sealed centres** (`isCenter(q,r) = (q+2r)%3===0`), never rendered or entered. Each ring hex is bordered by 3 centres on alternating walls, leaving exactly 3 matching doors. `isDoor`/`neighborOf`/`hexToWorld`/`WALL_STEP` encode this; axial steps brute-force verified (shared-edge gap 0).
- **BigInt-coord variants** (`isCenterBig`, `isDoorBig`, `neighborOfBig`) exist because of the floating origin (below) — true coords are astronomically large.

### `lib/library.ts` — the page engine
Reversible bijection between a coordinate and its 3200-char page text. `coordToAddress` packs the coordinate (mixed-radix + Cantor pairing of zig-zagged q,r); an affine cipher `(A·addr + C) mod BASE^3200` scrambles it (A is a full-width multiplier so even tiny addresses produce full gibberish); base-decode → text. There are **BigInt-coord variants** (`PageCoordBig`, `coordToAddressBig`, `pageTextBig`) for the floating origin.
- **Reverse search**: `containsSearch(text)` builds a page that *contains* the query embedded in deterministic noise, then inverts the affine to its address; `containsSearchWords(text)` does the same but fills the background with plausible English words (`lib/words.ts`). `pageFromAddrHex` travels to a raw `0x…` address. `addrHexToCoordBig` recovers the true (enormous) BigInt coordinate.
- **The tutorial book** lives at a real coordinate in spawn hex (1,0); `isTutorialBook`/`tutorialPages` give it gold styling + authored intro text.

### Floating origin (how "physical arrival" at far hexes works)
A searched page's hex is ~10^2000 away — impossible in float space. `worldStore.ts` holds a **BigInt origin (Q0,R0)**; rendering uses small local coords, true content coord = origin + local. On a search arrival the origin rebases onto the found hex, so the player physically stands and walks in that region. See `memory/origin-rebasing.md`.

### `components/` — the scene
- `Scene.tsx` — `<Canvas>`, fog, a single player-following `FollowLamp` (per-hex lights were the main perf cost), `<Physics>` (rapier), `<FlyThrough>`. `DEBUG` flag swaps in an `OrbitControls` fly-cam + rapier wireframes.
- `HexGrid.tsx` — spawns/despawns hexes within `RING` of the player; content uses the true BigInt coord via `worldStore`, rendering uses local `hexToWorld`. Skips sealed centres.
- `HexRoom.tsx` — one hex from a BigInt true coord (`tq,tr`): floor/ceiling/walls, per-wall door/solid from `isDoorBig`, bookshelves + colliders. `<Edges>` give the dark outlines.
- `Player.tsx` — rapier capsule, WASD accel-lerp, pointer-lock look, smoothed camera follow; freezes while reading/flying; re-locks pointer on close; teleports the capsule on search arrival.
- `Bookshelf.tsx` — instanced books (deterministic look + hover highlight). Each book is ONE merged geometry of **solid thick boards** (spine slab + left/right/tail/back cover boards, open top) plus a recessed cream **page block**, built by `bookGeometry()` via `boxBetween` + `mergeGeometries` with three material groups (`MAT_SPINE`/`PAGES`/`COVER`). Solid boards (not thin box faces) render from every angle — earlier thin-shell versions were 1px / invisible from inside. The spine slab's room-facing `+z` is the atlas (per-instance `aCell` picks one of 36 cells via an `onBeforeCompile` UV remap); `pagesMat` is excluded from the per-book `instanceColor` tint via `stripInstanceColor` so pages stay cream while leather takes the hue. Each shelf clones the shared geometry (own `aCell`). Walls are floor-to-ceiling shelving (`SHELVES_PER_WALL = 7`, `BOOKS_PER_SHELF = 32`); `SHELF_TOP = WALL_HEIGHT - 0.7` leaves headroom so the top row clears the ceiling. Click resolves `instanceId` → opens the book at its BigInt coord. **Changing `BOOKS_PER_SHELF`/`SHELVES_PER_WALL` changes the page-engine RADIX/address space — it's derived, stays consistent, but is not free to tweak.**
- `OpenBook.tsx` (3D portrait book, reflows page text), `BookOverlay.tsx` (DOM: coord/address readout, copy buttons, start hint, flying veil), `SearchBar.tsx` (`/` to search; noise vs english-words toggle; accepts `0x…` addresses), `FlyThrough.tsx` (travel animation), `bookStore.ts` + `worldStore.ts` + `playerState.ts` (stores).

### `lib/textures.ts` — surface textures
Mix of **real photographed PBR** (Poly Haven, CC0) and **procedural canvas** textures, all shared singletons (built/loaded once, reused by every hex — GPU uploads each map once).
- **Photo sets** live in `public/textures/<dir>/` as 1k jpg (`diff`/`nor`/`rough`); `photoTex(dir)` loads + caches them with `RepeatWrapping` and correct colorspaces (diff = sRGB, nor/rough = NoColorSpace). Currently **floor** = `marble_tiles`, **wall** = `wood_plank_wall`, **ceiling** = `wooden_panels`, **door reveal** = same plank wood as the wall (copied into its own `door/` dir so it can set its own repeat). This deliberately breaks the old "file-free, no assets" rule — the procedural surfaces looked too abstract; a few MB of jpg is the price. To add a new photo surface: drop `diff/nor/rough.jpg` (resize to 1k, e.g. `magick in.jpg -resize 1024x1024 -quality 82 out.jpg`) and call `photoTex("<dir>")`. No `ao` map — it needs a 2nd UV set (uv2) and the diffuse already bakes occlusion. Poly Haven REST API (`api.polyhaven.com/files/<asset>`) gives direct CC0 jpg URLs.
- **Procedural (canvas)** still used only for **shelf wood** (`woodTex`/`buildWood`) and the **book-spine atlas**. The spine atlas is a 6×6 grid of 36 antique leather spines drawn near-white so `instanceColor` tints each volume; `drawSpine` does grain/hubs/gilt label/foot tooling/worn edges. Procedural normal maps come from a Sobel heightfield of the colour canvas (`normalFromCanvas`).
- **Floor** uses **world-space UV** (set in `HexRoom`, `FLOOR_TILE`) so tiles run continuously across hex boundaries; its texture stays at `repeat = 1`. Wall/ceiling/door set their own `repeat` (ceiling 3×3, door 1×2) since their meshes use planar/face UVs.

### State sharing pattern
Per-frame runtime state lives in plain module singletons read/written in `useFrame` (`playerState.ts`); UI-reactive state uses `useSyncExternalStore` singletons (`bookStore.ts`, `worldStore.ts`). Prefer these over context/props for anything touched every frame.

## Project memory

Durable design decisions and hard-won findings are in `~/.claude/projects/-Users-vsht-Documents-Dev-house-of-entropy/memory/` (indexed by `MEMORY.md`). Check there for the build-order roadmap, the hex topology proof, the page-engine details, and deferred polish TODOs (textures, book-flip animation).
