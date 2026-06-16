// Wire protocol shared by the client (lib/net.ts) and the relay (server/relay.mjs, plain JS).
//
// Positions are ABSOLUTE: each client carries its own floating BigInt origin, so a peer's
// position is sent as the true hex coord (q,r as decimal strings — true coords exceed Number
// and JSON has no BigInt) plus the intra-hex float offset. The receiver subtracts ITS origin
// to localise (and culls peers in far-away regions). See lib/net.ts toLocalRender().

/** Player movement state. Sent client -> server ~15 Hz; relayed back stamped with `id`. */
export interface StateMsg {
  type: "state";
  tq: string; // true hex q, BigInt as decimal string
  tr: string; // true hex r, BigInt as decimal string
  ox: number; // intra-hex world-X offset (player X minus hex centre X)
  oz: number; // intra-hex world-Z offset
  y: number; // capsule Y (jump / crouch)
  yaw: number; // camera.rotation.y
  pitch: number; // camera.rotation.x
  flying: boolean; // true while mid-flythrough (avatar dims)
  t: number; // client send timestamp (ms) — informational; interp uses local receive time
}

export interface HelloMsg {
  type: "hello";
  name: string;
}

export interface ChatSendMsg {
  type: "chat";
  text: string;
}

/** A peer's state as the server stores/relays it (StateMsg + identity). */
export type ServerState = Omit<StateMsg, "type"> & { id: string; name: string };

// server -> client
export interface WelcomeMsg {
  type: "welcome";
  id: string;
  peers: ServerState[];
}
export interface StatesMsg {
  type: "states";
  players: ServerState[];
}
export interface JoinMsg {
  type: "join";
  id: string;
}
export interface LeaveMsg {
  type: "leave";
  id: string;
}
export interface NameMsg {
  type: "name";
  id: string;
  name: string;
}
export interface ChatBroadcastMsg {
  type: "chat";
  id: string;
  name: string;
  text: string;
}
export interface FullMsg {
  type: "full";
}

export type ServerMsg =
  | WelcomeMsg
  | StatesMsg
  | JoinMsg
  | LeaveMsg
  | NameMsg
  | ChatBroadcastMsg
  | FullMsg;
