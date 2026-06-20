"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFlying, finishFlythrough } from "./bookStore";
import { playerPos } from "./playerState";
import { getOrigin } from "./worldStore";
import { buildTravelPath, worldToHex } from "@/lib/babel";

const DURATION = 3.4; // a touch longer so the turns read
const STEPS = 14; // door-to-door hops in the travel route

// Corridor travel rush: instead of a blind forward blur, the camera actually threads a chain
// of door midpoints — gliding straight down a corridor, taking a few gentle 60° turns through
// the stacks — while the lightspeed veil + fog tunnel cover the motion. It then settles at the
// player's real standing position in the freshly-rebased region. The destination page is
// astronomically far, so this is an evocative journey rather than literal navigation.
export function FlyThrough() {
  const flying = useFlying();
  const { scene, camera } = useThree();
  const t = useRef(0);
  const homeRotY = useRef(0);
  const homeY = useRef(1.6);
  // Sampled travel polyline + its cumulative arc-length lookup.
  const path = useRef<THREE.Vector3[]>([]);
  const cum = useRef<number[]>([]);
  const total = useRef(0);
  const look = useRef(new THREE.Vector3());
  const baseFog = useRef<{ near: number; far: number } | null>(null);

  useEffect(() => {
    if (!flying) return;
    t.current = 0;
    homeRotY.current = camera.rotation.y;
    homeY.current = camera.position.y;

    // Build a door-midpoint route starting from the hex the player currently stands in,
    // heading the way the camera faces. Prepend the camera's exact position so the path
    // begins under our feet (no jump on the first frame).
    const [sq, sr] = worldToHex(camera.position.x, camera.position.z);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    // Slant the initial heading off the facing axis so the route is forced to bend through a
    // couple of 60° turns instead of running dead-straight down one corridor.
    const slant = Math.PI / 7;
    const hx = fwd.x * Math.cos(slant) - fwd.z * Math.sin(slant);
    const hz = fwd.x * Math.sin(slant) + fwd.z * Math.cos(slant);
    // Test doors/centres against TRUE coords (origin + local) so the route follows the rooms
    // actually rendered after a floating-origin rebase — otherwise the 2nd+ search starts in a
    // locally-"sealed" hex, the route comes back empty, and we fall back to a wall-piercing line.
    const o = getOrigin();
    const route = buildTravelPath(sq, sr, [hx, hz], STEPS, 1, [o.q, o.r]);
    const pts: THREE.Vector3[] = [new THREE.Vector3(camera.position.x, homeY.current, camera.position.z)];
    for (const [x, z] of route.pts) pts.push(new THREE.Vector3(x, homeY.current, z));
    // Fallback: if the route is degenerate (cornered), just push straight forward.
    if (pts.length < 2) {
      pts.push(pts[0].clone().addScaledVector(new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), 60));
    }
    path.current = pts;

    // cumulative arc length for constant-feel sampling
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1]));
    cum.current = c;
    total.current = c[c.length - 1] || 1;

    const fog = scene.fog as THREE.Fog | null;
    if (fog) baseFog.current = { near: fog.near, far: fog.far };
  }, [flying, scene, camera]);

  // Position on the polyline at arc-length s (0..total).
  function sampleAt(s: number, out: THREE.Vector3) {
    const pts = path.current;
    const c = cum.current;
    if (pts.length < 2) return out.copy(pts[0] ?? camera.position);
    const sc = Math.max(0, Math.min(total.current, s));
    let i = 1;
    while (i < c.length - 1 && c[i] < sc) i++;
    const segLen = c[i] - c[i - 1] || 1;
    const f = (sc - c[i - 1]) / segLen;
    return out.copy(pts[i - 1]).lerp(pts[i], f);
  }

  useFrame((_, delta) => {
    if (!flying) return;
    t.current += delta;
    const p = Math.min(1, t.current / DURATION);
    const fog = scene.fog as THREE.Fog | null;

    // Ease-in-out along the FULL route so we glide the whole corridor and turns.
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const s = eased * total.current;
    sampleAt(s, camera.position);
    camera.position.y = homeY.current;
    playerPos.x = camera.position.x;
    playerPos.z = camera.position.z;

    // Aim slightly ahead so the camera leans into each turn (smoothly via lerp-look).
    sampleAt(s + 3, look.current);
    look.current.y = homeY.current;
    const targetYaw = Math.atan2(camera.position.x - look.current.x, camera.position.z - look.current.z);
    // shortest-arc lerp toward the target yaw
    let dy = targetYaw - camera.rotation.y;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    camera.rotation.order = "YXZ";
    camera.rotation.y += dy * Math.min(1, 8 * delta);

    // tighten fog into a tunnel at the peak of the surge
    if (fog) {
      const tighten = Math.sin(p * Math.PI);
      fog.near = 2 + (1 - tighten) * 4;
      fog.far = 7 + (1 - tighten) * 11;
    }

    if (p >= 1) {
      camera.rotation.set(0, homeRotY.current, 0);
      if (fog && baseFog.current) {
        fog.near = baseFog.current.near;
        fog.far = baseFog.current.far;
      }
      finishFlythrough();
    }
  });

  return null;
}
