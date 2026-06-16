"use client";

// Renders one avatar per connected peer plus broadcasts the local player's state.
//
// Peers arrive as ABSOLUTE true hex coords (lib/net.ts). Every frame we localise each peer
// against the CURRENT origin (toLocalRender) — so an origin rebase (search) is free: a peer in
// a far-away region produces a |delta| ~10^2000 and is culled. The BigInt magnitude check MUST
// precede Number() — Number() on such a delta is ±Infinity and would NaN-poison three matrices.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CapsuleCollider, type RapierRigidBody } from "@react-three/rapier";
import { Billboard, Text, Edges } from "@react-three/drei";
import * as THREE from "three";
import { hexToWorld, hash01 } from "@/lib/babel";
import { getOrigin } from "./worldStore";
import { playerPos } from "./playerState";
import { isFlying } from "./bookStore";
import {
  getPeers,
  usePeerIds,
  sendState,
  type RemotePeer,
  type Sample,
} from "@/lib/net";
import { worldToHex } from "@/lib/babel";
import { trueCoord } from "./worldStore";

const INTERP_DELAY = 0.1; // s — render peers slightly in the past so we always interpolate
const SEND_HZ = 15;
const CULL_LIMIT = 100000n; // beyond this hex delta a peer is in a far region → not rendered
const PARK = 1e6; // where culled kinematic bodies are parked (out of play)
const EYE = 0.7; // capsule-centre to head offset, matches Player EYE_HEIGHT

interface LocalRender {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

// Absolute peer coord -> my local world XZ, or null if the peer is in a far region.
function toLocalRender(s: Sample, originQ: bigint, originR: bigint): LocalRender | null {
  const dq = s.tq - originQ;
  const dr = s.tr - originR;
  if (dq > CULL_LIMIT || dq < -CULL_LIMIT || dr > CULL_LIMIT || dr < -CULL_LIMIT) return null;
  const lq = Number(dq); // SAFE: magnitude bounded by the guard above
  const lr = Number(dr);
  const [hx, hz] = hexToWorld(lq, lr);
  return { x: hx + s.ox, y: s.y, z: hz + s.oz, yaw: s.yaw };
}

const TWO_PI = Math.PI * 2;
// shortest-angle lerp so yaw doesn't spin 360° across ±π
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % TWO_PI) - Math.PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

// Pick the two buffer samples bracketing renderTime and lerp between them (clamp at the ends).
function interpolate(buf: Sample[], renderTime: number): Sample | null {
  if (buf.length === 0) return null;
  if (buf.length === 1 || renderTime <= buf[0].rt) return buf[0];
  const last = buf[buf.length - 1];
  if (renderTime >= last.rt) return last;
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i];
    const b = buf[i + 1];
    if (renderTime >= a.rt && renderTime <= b.rt) {
      const span = b.rt - a.rt || 1;
      const t = (renderTime - a.rt) / span;
      return {
        tq: b.tq,
        tr: b.tr, // hex region from the newer sample; offset interpolated
        ox: a.ox + (b.ox - a.ox) * t,
        oz: a.oz + (b.oz - a.oz) * t,
        y: a.y + (b.y - a.y) * t,
        yaw: lerpAngle(a.yaw, b.yaw, t),
        pitch: a.pitch + (b.pitch - a.pitch) * t,
        rt: renderTime,
      };
    }
  }
  return last;
}

function hueColor(id: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return new THREE.Color().setHSL(hash01(h), 0.55, 0.55);
}

function Avatar({ id }: { id: string }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const face = useRef<THREE.MeshStandardMaterial>(null);
  const yawRef = useRef(0);
  const hue = useMemo(() => hueColor(id), [id]);

  useFrame((state) => {
    const peer: RemotePeer | undefined = getPeers().get(id);
    const g = group.current;
    if (!g) return;
    if (!peer || peer.buf.length === 0) {
      g.visible = false;
      body.current?.setNextKinematicTranslation({ x: PARK, y: PARK, z: PARK });
      return;
    }
    const renderTime = Date.now() - INTERP_DELAY * 1000;
    const s = interpolate(peer.buf, renderTime);
    const o = getOrigin();
    const r = s ? toLocalRender(s, o.q, o.r) : null;
    if (!r) {
      g.visible = false; // far region — culled (correct: different part of the library)
      body.current?.setNextKinematicTranslation({ x: PARK, y: PARK, z: PARK });
      return;
    }
    g.visible = true;
    g.position.set(r.x, r.y - EYE, r.z);
    yawRef.current = lerpAngle(yawRef.current, r.yaw, 0.4);
    g.rotation.y = yawRef.current;
    // solid collider tracks the visible body
    body.current?.setNextKinematicTranslation({ x: r.x, y: r.y, z: r.z });

    // uncanny flicker on the glowing-page face
    if (face.current) {
      const flick = 0.7 + Math.sin(state.clock.elapsedTime * 7 + id.charCodeAt(0)) * 0.25;
      face.current.emissiveIntensity = (peer.flying ? 0.4 : 1) * flick;
    }
  });

  return (
    <>
      {/* solid kinematic collider so the local player can't walk through avatars */}
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[PARK, PARK, PARK]}
      >
        <CapsuleCollider args={[0.5, 0.35]} />
      </RigidBody>

      {/* visual figure: a tall faceless librarian with a glowing book for a head */}
      <group ref={group} visible={false}>
        {/* robe: a tapering near-black column */}
        <mesh position={[0, 0, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.5, 1.7, 12]} />
          <meshStandardMaterial color="#0d0b09" roughness={0.95} metalness={0.0} />
          <Edges threshold={20} color="#2a2620" />
        </mesh>
        {/* shoulders hint */}
        <mesh position={[0, 0.78, 0]}>
          <sphereGeometry args={[0.26, 12, 8]} />
          <meshStandardMaterial color="#0d0b09" roughness={0.95} />
        </mesh>
        {/* the face: a hovering luminous open page, hue per-peer, flickering */}
        <mesh position={[0, 1.18, 0.06]}>
          <boxGeometry args={[0.34, 0.26, 0.04]} />
          <meshStandardMaterial
            ref={face}
            color="#f4ecd8"
            emissive={hue}
            emissiveIntensity={1}
            roughness={0.6}
          />
        </mesh>
        {/* faint nameplate, always facing the camera */}
        <Billboard position={[0, 1.6, 0]}>
          <Text fontSize={0.18} color="#cdbf9a" anchorX="center" anchorY="bottom" outlineWidth={0.004} outlineColor="#000">
            {(getPeers().get(id)?.name || id).slice(0, 24)}
          </Text>
        </Billboard>
      </group>
    </>
  );
}

// Throttled broadcaster: samples the local player + camera and sends absolute state ~15 Hz.
function Broadcaster() {
  const { camera } = useThree();
  const acc = useRef(0);
  useFrame((_state, delta) => {
    acc.current += delta;
    if (acc.current < 1 / SEND_HZ) return;
    acc.current = 0;
    const [lq, lr] = worldToHex(playerPos.x, playerPos.z);
    const { q: tq, r: tr } = trueCoord(lq, lr);
    const [hx, hz] = hexToWorld(lq, lr);
    sendState({
      tq: tq.toString(),
      tr: tr.toString(),
      ox: playerPos.x - hx,
      oz: playerPos.z - hz,
      y: playerPos.y,
      yaw: camera.rotation.y,
      pitch: camera.rotation.x,
      flying: isFlying(),
      t: Date.now(),
    });
  });
  return null;
}

export function RemoteAvatars() {
  const ids = usePeerIds();
  return (
    <>
      <Broadcaster />
      {ids.map((id) => (
        <Avatar key={id} id={id} />
      ))}
    </>
  );
}
