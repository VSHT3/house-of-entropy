"use client";

// Multiplayer client: one WebSocket to the presence relay. Mirrors the project's store pattern:
//  - per-frame data (peer positions) lives in plain module singletons read in useFrame.
//  - React-reactive data (peer list, names, chat log) uses useSyncExternalStore.
//
// Peer positions are stored ABSOLUTE (true BigInt hex coord). Rendering localises them every
// frame against the current origin via toLocalRender() in components/RemoteAvatars.tsx, so an
// origin rebase (search) needs zero protocol work — peers just re-localise or cull next frame.

import { useSyncExternalStore } from "react";
import type { ServerMsg, ServerState, StateMsg } from "./netTypes";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787";

export interface Sample {
  tq: bigint;
  tr: bigint;
  ox: number;
  oz: number;
  y: number;
  yaw: number;
  pitch: number;
  rt: number; // local receive time (ms) — interpolation clock, skew-safe
}

export interface RemotePeer {
  id: string;
  name: string;
  flying: boolean;
  buf: Sample[]; // most-recent-last, capped
}

export interface ChatLine {
  id: string;
  name: string;
  text: string;
  t: number;
}

const BUF_CAP = 4;
const CHAT_CAP = 60;

// --- per-frame singleton (positions) ---
const peers = new Map<string, RemotePeer>();
export function getPeers(): Map<string, RemotePeer> {
  return peers;
}

// --- reactive state ---
let myId: string | null = null;
let chat: ChatLine[] = [];
let chatFocused = false;

const listeners = new Set<() => void>();
function emit() {
  // snapshot the reactive bits so useSyncExternalStore sees new references
  peerIdsSnapshot = Array.from(peers.keys());
  rosterSnapshot = Array.from(peers.values()).map((p) => {
    const last = p.buf[p.buf.length - 1];
    return { id: p.id, name: p.name, tq: last ? last.tq : null, tr: last ? last.tr : null };
  });
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// --- socket lifecycle ---
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;
let pendingName: string | null = null;
let wantConnected = false;

function sampleFrom(s: ServerState, rt: number): Sample {
  return {
    tq: BigInt(s.tq),
    tr: BigInt(s.tr),
    ox: s.ox,
    oz: s.oz,
    y: s.y,
    yaw: s.yaw,
    pitch: s.pitch,
    rt,
  };
}

function pushSample(s: ServerState, rt: number) {
  if (s.id === myId) return;
  let peer = peers.get(s.id);
  let isNew = false;
  if (!peer) {
    peer = { id: s.id, name: s.name ?? "", flying: false, buf: [] };
    peers.set(s.id, peer);
    isNew = true;
  }
  peer.flying = !!s.flying;
  if (s.name) peer.name = s.name;
  // A `welcome` may carry peers whose `last` is still null (they haven't sent a state yet), so
  // tq/tr are undefined. Register the peer (so it shows in the roster) but don't push a sample —
  // BigInt(undefined) would throw and abort the whole message, dropping every peer after it.
  if (s.tq != null && s.tr != null) {
    peer.buf.push(sampleFrom(s, rt));
    if (peer.buf.length > BUF_CAP) peer.buf.shift();
  }
  if (isNew) emit();
}

function handle(msg: ServerMsg) {
  const now = Date.now();
  switch (msg.type) {
    case "welcome": {
      myId = msg.id;
      for (const s of msg.peers) pushSample(s, now);
      if (pendingName) sendRaw({ type: "hello", name: pendingName });
      emit();
      break;
    }
    case "states": {
      for (const s of msg.players) pushSample(s, now);
      break; // positions are read per-frame, not via React — no emit
    }
    case "join": {
      // Register the peer immediately (even before it moves) so it shows in the roster. The
      // avatar still only renders once a position sample arrives (RemoteAvatars hides empty bufs).
      if (msg.id !== myId && !peers.has(msg.id)) {
        peers.set(msg.id, { id: msg.id, name: msg.name ?? "", flying: false, buf: [] });
        emit();
      }
      break;
    }
    case "leave":
      if (peers.delete(msg.id)) emit();
      break;
    case "name": {
      const p = peers.get(msg.id);
      if (p) {
        p.name = msg.name;
        emit();
      }
      break;
    }
    case "chat":
      chat = [...chat, { id: msg.id, name: msg.name, text: msg.text, t: now }].slice(-CHAT_CAP);
      emit();
      break;
    case "full":
      console.warn("[net] relay full — not connected");
      break;
  }
}

function sendRaw(obj: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function connect() {
  wantConnected = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn("[net] connect failed", e);
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    backoff = 1000;
    if (pendingName) sendRaw({ type: "hello", name: pendingName });
  };
  ws.onmessage = (ev) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    handle(msg);
  };
  ws.onclose = () => {
    ws = null;
    myId = null;
    if (peers.size) {
      peers.clear();
      emit();
    }
    if (wantConnected) scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose will follow and drive reconnect
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantConnected) connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 10000);
}

export function disconnect() {
  wantConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // suppress reconnect
    ws.close();
    ws = null;
  }
  myId = null;
  peers.clear();
  emit();
}

// --- outbound ---
export function sendState(s: Omit<StateMsg, "type">) {
  sendRaw({ type: "state", ...s });
}

export function setName(name: string) {
  pendingName = name;
  if (typeof localStorage !== "undefined") localStorage.setItem("hoe-name", name);
  sendRaw({ type: "hello", name });
}

export function getMyName(): string {
  if (typeof localStorage !== "undefined") return localStorage.getItem("hoe-name") ?? "";
  return pendingName ?? "";
}

// A roster row: display name + latest absolute true hex coord (or null if no sample yet).
export interface RosterEntry {
  id: string;
  name: string;
  tq: bigint | null;
  tr: bigint | null;
}
export function getRoster(): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const p of peers.values()) {
    const last = p.buf[p.buf.length - 1];
    out.push({ id: p.id, name: p.name, tq: last ? last.tq : null, tr: last ? last.tr : null });
  }
  return out;
}

// Reactive roster membership: re-snapshotted on every emit (join/leave/welcome/name), so a
// component using this re-renders when peers come and go. Distances still need a periodic tick
// since positions arrive via `states` (which intentionally doesn't emit).
let rosterSnapshot: RosterEntry[] = [];
export function useRoster(): RosterEntry[] {
  return useSyncExternalStore(subscribe, () => rosterSnapshot, () => rosterSnapshot);
}

// connection state, for an honest "you're offline / alone" roster message
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function sendChat(text: string) {
  const t = text.trim();
  if (t) sendRaw({ type: "chat", text: t });
}

// --- chat input focus (so typing doesn't drive WASD; read by Player.tsx) ---
export function setChatFocused(v: boolean) {
  chatFocused = v;
}
export function isChatFocused(): boolean {
  return chatFocused;
}

// --- reactive hooks ---
let peerIdsSnapshot: string[] = [];
export function usePeerIds(): string[] {
  return useSyncExternalStore(subscribe, () => peerIdsSnapshot, () => peerIdsSnapshot);
}
export function useChat(): ChatLine[] {
  return useSyncExternalStore(subscribe, () => chat, () => chat);
}
export function useMyId(): string | null {
  return useSyncExternalStore(subscribe, () => myId, () => myId);
}
