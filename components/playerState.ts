// Shared mutable player world position, written by <Player> each frame and read by
// systems that need it (e.g. <HexGrid> deciding which hexes to keep live).
import { hexToWorld } from "@/lib/babel";
const s = hexToWorld(1, 0); // ring-hex spawn, matches <Player>
export const playerPos = { x: s[0], y: 0, z: s[1] };
