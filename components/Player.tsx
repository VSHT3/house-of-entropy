"use client";

import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { RigidBody, CapsuleCollider, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { playerPos } from "./playerState";
import { isInputLocked, isFlying, useOpenState, useFlying, useArrival } from "./bookStore";
import { hexToWorld } from "@/lib/babel";

// Spawn in a ring room, not a sealed centre. Hex (1,0) is a ring hex.
const SPAWN = hexToWorld(1, 0);
// Face the golden tutorial book on wall 1 at spawn (yaw computed from wall-1 midpoint).
const SPAWN_YAW = -0.5236 + Math.PI;

const SPEED = 4.5; // m/s walk
const EYE_HEIGHT = 0.7; // camera offset above capsule centre
const ACCEL = 12; // how fast we ramp toward target velocity (higher = snappier)
const CAM_SMOOTH = 18; // camera follow stiffness (higher = tighter to body)

const keys: Record<string, boolean> = {};

function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => (keys[e.code] = true);
    const up = (e: KeyboardEvent) => (keys[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}

export function Player() {
  const body = useRef<RapierRigidBody>(null);
  const { camera } = useThree();
  const reading = useOpenState() !== null;
  const flying = useFlying();
  const locked = reading || flying; // freeze controls while reading or travelling
  const arrival = useArrival();
  useKeyboard();

  // On a search arrival, teleport the physics capsule + camera to the chosen local ring hex
  // in the freshly-rebased region (so the player is physically standing in a real room).
  useEffect(() => {
    if (arrival.nonce === 0) return;
    const [x, z] = hexToWorld(arrival.lq, arrival.lr);
    body.current?.setTranslation({ x, y: 1.0, z }, true);
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerPos.x = x;
    playerPos.y = 1.0;
    playerPos.z = z;
    camera.position.set(x, 1.6, z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival.nonce]);

  // reusable vectors
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  const UP = useRef(new THREE.Vector3(0, 1, 0));
  const camTarget = useRef(new THREE.Vector3());
  const lockRef = useRef<{ lock: () => void } | null>(null);

  // Aim the camera at the golden tutorial book once on spawn.
  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, SPAWN_YAW, 0);
    camera.position.set(SPAWN[0], 1.6, SPAWN[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When reading/flying ends, re-grab pointer lock so look control resumes without a click.
  useEffect(() => {
    if (!locked) {
      const id = setTimeout(() => {
        try {
          lockRef.current?.lock();
        } catch {
          /* browser may refuse immediately after exit; user can click */
        }
      }, 80);
      return () => clearTimeout(id);
    }
  }, [locked]);

  useFrame((_, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 1 / 30); // clamp big frame gaps

    // camera-relative horizontal basis
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, UP.current).normalize();

    // target horizontal velocity from input — frozen while reading a book
    dir.current.set(0, 0, 0);
    if (!isInputLocked()) {
      if (keys["KeyW"]) dir.current.add(forward.current);
      if (keys["KeyS"]) dir.current.sub(forward.current);
      if (keys["KeyD"]) dir.current.add(right.current);
      if (keys["KeyA"]) dir.current.sub(right.current);
      if (dir.current.lengthSq() > 0) dir.current.normalize().multiplyScalar(SPEED);
    }

    // ease current velocity toward target -> acceleration on start, glide on stop
    const v = rb.linvel();
    const t = 1 - Math.exp(-ACCEL * dt); // framerate-independent lerp factor
    const vx = v.x + (dir.current.x - v.x) * t;
    const vz = v.z + (dir.current.z - v.z) * t;
    rb.setLinvel({ x: vx, y: v.y, z: vz }, true); // keep gravity on y

    // While the flythrough is running it owns the camera + playerPos — don't fight it.
    if (isFlying()) return;

    // smooth camera follow (decouples render from fixed physics step -> no jitter)
    const p = rb.translation();
    playerPos.x = p.x;
    playerPos.y = p.y;
    playerPos.z = p.z;
    camTarget.current.set(p.x, p.y + EYE_HEIGHT, p.z);
    const ct = 1 - Math.exp(-CAM_SMOOTH * dt);
    camera.position.lerp(camTarget.current, ct);
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        mass={1}
        position={[SPAWN[0], 1.0, SPAWN[1]]}
        enabledRotations={[false, false, false]}
        canSleep={false}
        ccd
      >
        <CapsuleCollider args={[0.5, 0.35]} />
      </RigidBody>
      {!locked && <PointerLockControls ref={lockRef as never} />}
    </>
  );
}
