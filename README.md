# House of Entropy

A web app that lets you **walk Borges' Library of Babel in first-person 3D**.

Inspired by Jorge Luis Borges' 1941 story *La biblioteca de Babel*, the Library contains
every possible book. Here you wander an endless honeycomb of hexagonal rooms, pull books off
the shelves, and read pages whose text is **computed on demand** — nothing is stored. Every
page is a pure function of its location, and the mapping is reversible, so you can also
**search for any text** and physically travel to the page that contains it.

## Features

- **First-person 3D library** — grounded WASD walk, mouse-look, faithful Borges hexagons
  (shelves on solid walls, doorways on the others), built with react-three-fiber + Rapier.
- **Endless, consistent world** — a "flower" hex tiling (sealed centre hexes) gives every
  room exactly three aligned doorways; walk forever, loops stay consistent.
- **Real generated books** — click a book to open it in 3D and read a page. Each page is
  3200 characters from a reversible BigInt bijection between coordinate and text.
- **Reverse search** — press `/`, type any text, and travel to a page that contains it
  (in raw noise, or surrounded by plausible English words). Paste a `0x…` address to jump
  straight there. Copy a result's address or coordinate to share it.
- **Floating origin** — searched pages live astronomically far away; the world rebases onto
  the found hex so you genuinely stand and walk in that distant region.

## Controls

| Action | Key |
| --- | --- |
| Enter / lock pointer | click |
| Move | `W` `A` `S` `D` |
| Look | mouse |
| Read a book | click it |
| Turn pages | `←` `→` |
| Search | `/` |
| Close / release | `Esc` |

Start by finding the **golden book** in the spawn room — it's the tutorial.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm run start   # production
npm run lint
npx tsc --noEmit                 # typecheck (no test suite)
```

Requires Node 20+ (uses BigInt over a multi-thousand-digit modulus).

## Tech

Next.js (App Router, Turbopack) · TypeScript · react-three-fiber / three.js · @react-three/drei ·
@react-three/rapier · Tailwind CSS.

## How the page engine works

A page is 3200 characters over a 35-symbol alphabet, so there are `35^3200` possible pages.
Each coordinate `{q, r, wall, shelf, book, page}` is packed into a single integer address,
passed through an invertible affine cipher modulo `35^3200`, and base-decoded into text. The
cipher is reversible, so given any text we can recover the address it lives at — that is the
search feature. See [`CLAUDE.md`](./CLAUDE.md) for the full architecture and
[`TODO.md`](./TODO.md) for what's next.

## License

MIT
