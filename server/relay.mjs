// House of Entropy — multiplayer presence relay.
//
// Standalone WebSocket server (its own process / Coolify service). The Next app deploys as
// `output: "standalone"` which runs its own `node server.js` with no WS upgrade hook, so the
// relay lives outside it. It is pure presence: it holds each connected peer's last-known state
// in memory and fans it out on a fixed tick. Nothing is persisted.
//
// Protocol (JSON text frames):
//   client -> server: {type:"state",...}  {type:"hello",name}  {type:"chat",text}
//   server -> client: {type:"welcome",id,peers[]}  {type:"states",players[]}
//                     {type:"join",id}  {type:"leave",id}  {type:"name",id,name}  {type:"chat",id,name,text}

import { createServer } from "http";
import { randomUUID } from "crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8787;
const TICK_MS = 50; // 20 Hz broadcast of batched states
const MAX_PEERS = 50;
const MAX_NAME = 24;
const MAX_CHAT = 280;
const CHAT_BURST = 5; // max chat msgs per window
const CHAT_WINDOW_MS = 5000;

// `visible` gates a peer into the roster/avatars. A bare socket (port scanner, uptime probe,
// crawler) opens a connection but never speaks the protocol — it must NOT show up as a peer.
// A real client always sends `hello` (its name) on connect and `state` ~15 Hz; either flips
// `visible` true and triggers the deferred `join`. Until then the peer is held silently.
/** @type {Map<string, {ws: import('ws').WebSocket, last: object|null, name: string, chatTimes: number[], visible: boolean}>} */
const peers = new Map();

// Promote a peer to visible on its first real protocol message and announce it once.
const reveal = (id, me) => {
  if (me.visible) return;
  me.visible = true;
  broadcast({ type: "join", id, name: me.name }, id);
};

// Health-check HTTP server (Coolify pings it); WS shares the same port.
const http = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`hoe-relay ok (${peers.size} peers)\n`);
});
const wss = new WebSocketServer({ server: http });

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};
const broadcast = (obj, exceptId) => {
  const msg = JSON.stringify(obj);
  for (const [id, p] of peers) {
    if (id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
};
// Strip ASCII control chars (incl. newlines/tabs), then trim and length-cap.
const sanitize = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, max)
    .trim();

wss.on("connection", (ws) => {
  if (peers.size >= MAX_PEERS) {
    send(ws, { type: "full" });
    ws.close();
    return;
  }
  const id = randomUUID().slice(0, 8);
  peers.set(id, { ws, last: null, name: "", chatTimes: [], visible: false });
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  // Seed the newcomer with everyone already VISIBLE — including peers who haven't sent a state
  // yet (no `last`), so a motionless reader still appears in the roster. Coords are simply
  // omitted for them; the client tolerates that. Unidentified sockets (scanners) are skipped.
  const existing = [];
  for (const [pid, p] of peers) {
    if (pid === id || !p.visible) continue;
    existing.push({ id: pid, name: p.name, ...(p.last || {}) });
  }
  send(ws, { type: "welcome", id, peers: existing });
  // No `join` broadcast yet: this peer is announced only once it identifies (hello/state) via
  // reveal(). A socket that never speaks the protocol stays invisible to everyone.

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const me = peers.get(id);
    if (!me) return;

    if (msg.type === "state") {
      // Server stamps id; clients never assert their own id (no spoofing peers).
      const { tq, tr, ox, oz, y, yaw, pitch, flying, t } = msg;
      me.last = { tq, tr, ox, oz, y, yaw, pitch, flying, t };
      reveal(id, me); // a moving client is real — announce it if not already
    } else if (msg.type === "hello") {
      me.name = sanitize(msg.name, MAX_NAME);
      reveal(id, me); // first hello reveals; the join already carries the name
      broadcast({ type: "name", id, name: me.name });
    } else if (msg.type === "chat") {
      const now = Date.now();
      me.chatTimes = me.chatTimes.filter((ts) => now - ts < CHAT_WINDOW_MS);
      if (me.chatTimes.length >= CHAT_BURST) return; // rate limited
      me.chatTimes.push(now);
      const text = sanitize(msg.text, MAX_CHAT);
      if (text) broadcast({ type: "chat", id, name: me.name, text });
    }
  });

  ws.on("close", () => {
    const wasVisible = peers.get(id)?.visible;
    peers.delete(id);
    // Only announce a leave for peers clients actually saw; a silent scanner never joined.
    if (wasVisible) broadcast({ type: "leave", id });
  });
  ws.on("error", () => { /* close handler does cleanup */ });
});

// Batched broadcast: one message per tick carrying every peer's last state; each client
// filters out its own id. Avoids per-inbound-packet N^2 fan-out.
setInterval(() => {
  const players = [];
  for (const [id, p] of peers) if (p.last) players.push({ id, name: p.name, ...p.last });
  if (!players.length) return;
  const msg = JSON.stringify({ type: "states", players });
  for (const p of peers.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}, TICK_MS);

// Heartbeat: drop dead sockets so crashed tabs emit a leave.
setInterval(() => {
  for (const p of peers.values()) {
    if (p.ws.isAlive === false) { p.ws.terminate(); continue; }
    p.ws.isAlive = false;
    p.ws.ping();
  }
}, 30000);

http.listen(PORT, () => console.log(`hoe-relay listening on :${PORT}`));
