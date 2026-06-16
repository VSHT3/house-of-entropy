"use client";

import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { RigidBody, CapsuleCollider, useRapier, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { playerPos } from "./playerState";
import { isInputLocked, isFlying, isFreeFly, toggleFreeFly, useOpenState, useFlying, useFreeFly, useArrival } from "./bookStore";
import { isChatFocused } from "@/lib/net";
import { hexToWorld } from "@/lib/babel";

// Spawn in a ring room, not a sealed centre. Hex (1,0) is a ring hex.
const SPAWN = hexToWorld(1, 0);
// Face the golden tutorial book on wall 1 at spawn (yaw computed from wall-1 midpoint).
const SPAWN_YAW = -0.5236 + Math.PI;

const SPEED = 4.5; // m/s walk
const SPRINT_SPEED = 7.5; // m/s while holding Shift
const FLY_SPEED = 9.0; // m/s noclip fly
const FLY_SPRINT = 22.0; // m/s noclip fly while holding Shift
const CROUCH_SPEED = 2.0; // m/s while crouched
const EYE_HEIGHT = 0.7; // camera offset above capsule centre
const CROUCH_EYE = 0.1; // lowered camera offset while crouched
const ACCEL = 12; // ground ramp toward target velocity (higher = snappier)
const AIR_ACCEL = 2.5; // much weaker steering while airborne -> momentum is preserved
const CAM_SMOOTH = 18; // camera follow stiffness (higher = tighter to body)

// Snappy, low hop: low launch speed + heavy gravity (GRAVITY_SCALE on the body) make a quick
// arc whose head peak stays under the 2.6 m doorway lintel.
const JUMP_VEL = 4.4; // upward launch speed (m/s)
const GRAVITY_SCALE = 1.7; // extra gravity -> snappy arc, apex stays under the 3.2 m lintel
const CAP_HALF = 0.5; // capsule half-height
const CAP_RADIUS = 0.35; // capsule radius
const GROUND_REACH = 0.18; // how far below the capsule we still count as "grounded"

// Bunny hop: a jump landed within this window after the previous one keeps and boosts
// horizontal momentum instead of decaying it. No cap — chaining hops accelerates freely.
const HOP_WINDOW = 0.35; // s — forgiving grace period after landing to chain a hop
const HOP_BOOST = 1.12; // speed multiplier on a chained hop (compounds across hops)

const keys: Record<string, boolean> = {};

function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // While typing in chat, let keystrokes reach the input and don't record movement.
      if (isChatFocused()) return;
      keys[e.code] = true;
      // Space scrolls the page and Ctrl/Tab are browser-reserved; suppress while playing.
      if (e.code === "Space") e.preventDefault();
      // F toggles noclip free-fly (ignored if a book/search input has focus).
      if (e.code === "KeyF" && !isInputLocked()) toggleFreeFly();
    };
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
  const { world, rapier } = useRapier();
  const { camera } = useThree();
  const reading = useOpenState() !== null;
  const flying = useFlying();
  const freeFly = useFreeFly();
  const locked = reading || flying; // freeze controls while reading or travelling (NOT free-fly)
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

  // movement state across frames
  const wasGrounded = useRef(false);
  const landedAt = useRef(-1); // timestamp of last landing (s)
  const eyeRef = useRef(EYE_HEIGHT); // smoothed eye height (for crouch)
  const bobPhase = useRef(0); // head-bob phase, advanced by ground speed
  const bobAmt = useRef(0); // smoothed bob amplitude (eases in/out with movement)

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

  useFrame((state, delta) => {
    const rb = body.current;
    if (!rb) return;
    const dt = Math.min(delta, 1 / 30); // clamp big frame gaps
    const now = state.clock.elapsedTime;
    const frozen = isInputLocked() || isChatFocused();

    // camera-relative horizontal basis
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, UP.current).normalize();

    const v = rb.linvel();
    const p = rb.translation();

    // --- noclip free-fly: detach gravity, move the body along the full camera direction.
    // Collision is off (kinematicPosition body, see RigidBody below) so we phase through walls.
    if (isFreeFly()) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd); // full 3D look direction (includes pitch)
      const rightV = new THREE.Vector3().crossVectors(fwd, UP.current).normalize();
      const move = new THREE.Vector3();
      if (!frozen) {
        if (keys["KeyW"]) move.add(fwd);
        if (keys["KeyS"]) move.sub(fwd);
        if (keys["KeyD"]) move.add(rightV);
        if (keys["KeyA"]) move.sub(rightV);
        if (keys["Space"]) move.y += 1; // rise
        if (keys["ControlLeft"] || keys["KeyC"]) move.y -= 1; // descend
      }
      const flySpeed = keys["ShiftLeft"] || keys["ShiftRight"] ? FLY_SPRINT : FLY_SPEED;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(flySpeed * dt);
      const nx = p.x + move.x, ny = p.y + move.y, nz = p.z + move.z;
      rb.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      playerPos.x = nx;
      playerPos.y = ny;
      playerPos.z = nz;
      // camera rides the body directly (no smoothing/bob in fly mode)
      camera.position.set(nx, ny, nz);
      return;
    }

    // --- ground check: cast a short ray straight down from the capsule bottom -------------
    const origin = { x: p.x, y: p.y - (CAP_HALF + CAP_RADIUS) + 0.02, z: p.z };
    const ray = new rapier.Ray(origin, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, GROUND_REACH, true, undefined, undefined, undefined, rb);
    const grounded = hit !== null;

    // record the moment we touch down (opens the bunny-hop window)
    if (grounded && !wasGrounded.current) landedAt.current = now;
    wasGrounded.current = grounded;

    const crouching = !frozen && (keys["ControlLeft"] || keys["KeyC"]);
    const sprinting = !frozen && !crouching && (keys["ShiftLeft"] || keys["ShiftRight"]);
    const moveSpeed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : SPEED;

    // target horizontal velocity from input — frozen while reading a book
    dir.current.set(0, 0, 0);
    if (!frozen) {
      if (keys["KeyW"]) dir.current.add(forward.current);
      if (keys["KeyS"]) dir.current.sub(forward.current);
      if (keys["KeyD"]) dir.current.add(right.current);
      if (keys["KeyA"]) dir.current.sub(right.current);
      if (dir.current.lengthSq() > 0) dir.current.normalize().multiplyScalar(moveSpeed);
    }

    // Decide whether we jump THIS frame, before touching horizontal velocity. Holding Space
    // keeps hopping (auto-jump on every ground contact) — that's what lets a chain happen at
    // all; requiring a release between hops made the window practically impossible to hit.
    const wantJump = !frozen && keys["Space"];
    const willJump = wantJump && grounded;
    const chained = willJump && landedAt.current >= 0 && now - landedAt.current <= HOP_WINDOW;

    // entry (pre-decel) horizontal velocity — the momentum we landed with
    const entrySpeed = Math.hypot(v.x, v.z);

    let vx: number;
    let vz: number;
    let vy = v.y;

    if (willJump) {
      // A jump leaves the ground immediately, so DON'T apply ground decel this frame. Carry the
      // entry velocity straight through (optionally boosted) — the touch-down frame can't bleed
      // the chain. If there's no real momentum yet, fall back to the input direction.
      vy = JUMP_VEL;
      let dx = v.x;
      let dz = v.z;
      if (entrySpeed < 0.3 && dir.current.lengthSq() > 0) {
        dx = dir.current.x;
        dz = dir.current.z;
      }
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        // chained hop grows from at least walk speed; a lone jump just preserves momentum.
        const boosted = chained ? Math.max(entrySpeed, SPEED) * HOP_BOOST : Math.max(entrySpeed, len);
        vx = (dx / len) * boosted;
        vz = (dz / len) * boosted;
      } else {
        vx = v.x;
        vz = v.z;
      }
      landedAt.current = -1; // consume the window so the next contact reopens it
    } else if (grounded) {
      // crisp control on the ground: lerp horizontal velocity toward the input target
      const t = 1 - Math.exp(-ACCEL * dt);
      vx = v.x + (dir.current.x - v.x) * t;
      vz = v.z + (dir.current.z - v.z) * t;
    } else {
      // Airborne: NEVER bleed speed. Keep momentum, only add a small steering nudge.
      vx = v.x;
      vz = v.z;
      if (dir.current.lengthSq() > 0) {
        const inv = 1 / Math.hypot(dir.current.x, dir.current.z);
        vx += dir.current.x * inv * AIR_ACCEL * dt;
        vz += dir.current.z * inv * AIR_ACCEL * dt;
      }
    }

    rb.setLinvel({ x: vx, y: vy, z: vz }, true);

    // While the flythrough is running it owns the camera + playerPos — don't fight it.
    if (isFlying()) return;

    // smooth camera follow (decouples render from fixed physics step -> no jitter)
    playerPos.x = p.x;
    playerPos.y = p.y;
    playerPos.z = p.z;
    // crouch lowers the eye smoothly
    const targetEye = crouching ? CROUCH_EYE : EYE_HEIGHT;
    eyeRef.current += (targetEye - eyeRef.current) * (1 - Math.exp(-12 * dt));

    // head-bob: advance phase with ground speed; amplitude eases with how fast we move and
    // grows when sprinting. Off while airborne so jumps read clean.
    const hspeed = Math.hypot(vx, vz);
    const moving = grounded && hspeed > 0.4;
    bobPhase.current += hspeed * 1.9 * dt; // step cadence scales with speed
    const targetBob = moving ? Math.min(hspeed / SPEED, 1.4) * (sprinting ? 0.05 : 0.03) : 0;
    bobAmt.current += (targetBob - bobAmt.current) * (1 - Math.exp(-8 * dt));
    const bobY = Math.sin(bobPhase.current * 2) * bobAmt.current; // vertical (double freq)
    const bobX = Math.cos(bobPhase.current) * bobAmt.current * 0.6; // gentle side sway

    camTarget.current.set(
      p.x + right.current.x * bobX,
      p.y + eyeRef.current + bobY,
      p.z + right.current.z * bobX,
    );
    const ct = 1 - Math.exp(-CAM_SMOOTH * dt);
    camera.position.lerp(camTarget.current, ct);
  });

  return (
    <>
      <RigidBody
        // Remount when toggling fly so the body type flips cleanly. Seed its position from the
        // live player pos (not stale SPAWN) so we don't snap back on toggle.
        key={freeFly ? "fly" : "walk"}
        ref={body}
        colliders={false}
        type={freeFly ? "kinematicPosition" : "dynamic"}
        mass={1}
        position={[playerPos.x, playerPos.y || 1.0, playerPos.z]}
        enabledRotations={[false, false, false]}
        gravityScale={GRAVITY_SCALE}
        canSleep={false}
        ccd
      >
        {!freeFly && <CapsuleCollider args={[0.5, 0.35]} />}
      </RigidBody>
      {!locked && <PointerLockControls ref={lockRef as never} />}
    </>
  );
}
