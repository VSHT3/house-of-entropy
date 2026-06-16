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
