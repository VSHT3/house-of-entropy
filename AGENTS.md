<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Multiplayer relay

`server/` is a **separate Node package** (the WebSocket presence relay), NOT part of the Next
build. It has its own `package.json`/`Dockerfile` and deploys as its own service. The Next app
talks to it over `NEXT_PUBLIC_WS_URL` (inlined at build). Run both locally with `npm run dev:all`.
Positions cross the wire as **absolute** BigInt hex coords (decimal strings) + intra-hex offset;
the receiver re-localises against its floating origin every frame. The BigInt magnitude guard
must precede any `Number()` on a coord delta — see `memory/multiplayer.md`.

**Roster / presence:** a peer must be registered the moment it joins, not on its first `state` —
otherwise a motionless reader is invisible to everyone already connected. The relay `welcome`
includes coord-less peers (`...(p.last||{})`) and `join` carries `name`; the client registers on
`join` and `pushSample` skips the sample (but still registers the peer) when `tq/tr` are null —
`BigInt(undefined)` would throw and abort the whole `welcome`, dropping every peer after it. The
roster UI reads the reactive `useRoster()` snapshot (rebuilt in `emit()`).
