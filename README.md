# House of Entropy

*Walk Borges' Library of Babel in first-person 3D — and you are not alone in it.*

Inspired by Jorge Luis Borges' 1941 story *La biblioteca de Babel*, the Library contains
every possible book. You wander an endless honeycomb of dim hexagonal rooms, pull books off
the shelves, and read pages whose text is **computed on demand** — nothing is stored. Every
page is a pure function of its location, and the mapping is reversible, so you can also
**search for any text** and physically travel to the page that holds it.

Other readers haunt the same stacks. They appear as faceless **librarians** — robed figures
with a glowing page where a face should be — drifting between the shelves in real time. Pass
them, follow them, or call out across the dark.

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
- **Multiplayer** — everyone spawns in the same room and sees each other as librarian avatars,
  moving in real time, with names and chat. Positions are sent as *absolute* coordinates, so
  two readers stay in sync even across the floating origin; wander into different regions of
  the infinite library and you simply lose sight of one another.

## Controls

| Action | Key |
| --- | --- |
| Enter / lock pointer | click |
| Walk | `W` `A` `S` `D` |
| Look | mouse |
| Jump | `Space` |
| Run | `Shift` |
| Crouch | `Ctrl` / `C` |
| Free-fly (noclip) | `F` |
| Read a book | click it |
| Turn pages | `←` `→` |
| Search the stacks | `/` |
| Chat | `Enter` |
| Close / release | `Esc` |

Start by finding the **golden book** in the spawn room — it's the tutorial.

## Run locally

```bash
npm install
npm run relay:install            # one-time: deps for the multiplayer relay (server/)
npm run dev:all                  # Next app + WS relay together
# → app at http://localhost:3000, relay at ws://localhost:8787
```

Or run them separately:

```bash
npm run dev                      # just the app (no multiplayer)
npm run relay                    # just the relay
```

```bash
npm run build && npm run start   # production
npm run lint
npx tsc --noEmit                 # typecheck (no test suite)
```

Requires Node 20+ (uses BigInt over a multi-thousand-digit modulus).

## Multiplayer

The world is single-page and computed in the browser; presence is the only thing that needs a
server. A tiny standalone WebSocket relay (`server/relay.mjs`, Node + `ws`) fans out each
player's state — it stores nothing and runs as its own process. Clients broadcast their
**absolute** hex coordinate (BigInt, sent as a decimal string) plus a small intra-hex offset;
each client re-localises everyone against its own floating origin every frame, so an origin
rebase from a search needs no protocol at all.

Configure the relay URL with `NEXT_PUBLIC_WS_URL` (see `.env.example`); it defaults to
`ws://localhost:8787`. Because it's a `NEXT_PUBLIC_*` value it is **inlined at build time**.

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

## Deploy (Docker / Coolify)

The app ships as a Next standalone image (`Dockerfile`). The relay is a **separate** image
(`server/Dockerfile`) — a git push rebuilds the app, but the relay must be added once as a
second service:

1. **App service** — build from the repo `Dockerfile`. Set build arg
   `NEXT_PUBLIC_WS_URL=wss://relay.<your-host>` (build arg, not runtime — it's inlined).
2. **Relay service** — build from `server/Dockerfile`, expose port `8787`, give it the domain
   used above (`wss://relay.<your-host>`). It needs no env beyond an optional `PORT`.

After both exist, pushing to the default branch auto-rebuilds the app on each commit; the relay
only rebuilds when `server/` changes.

## License

MIT
