"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFlying, finishFlythrough } from "./bookStore";
import { playerPos } from "./playerState";

const DURATION = 2.8;

// Ground-level travel rush: the camera surges forward at eye height through the stacks while
// the lightspeed blur (DOM veil) covers the motion, then settles back at the player's real
// standing position so they resume inside their lit room. The destination page is
// astronomically far, so this is an evocative journey rather than literal navigation.
export function FlyThrough() {
  const flying = useFlying();
  const { scene, camera } = useThree();
  const t = useRef(0);
  const home = useRef(new THREE.Vector3());
  const homeRotY = useRef(0);
  const dir = useRef(new THREE.Vector3());
  const baseFog = useRef<{ near: number; far: number } | null>(null);

  useEffect(() => {
    if (flying) {
      t.current = 0;
      home.current.copy(camera.position);
      homeRotY.current = camera.rotation.y;
      camera.getWorldDirection(dir.current);
      dir.current.y = 0;
      dir.current.normalize();
      const fog = scene.fog as THREE.Fog | null;
      if (fog) baseFog.current = { near: fog.near, far: fog.far };
    }
  }, [flying, scene, camera]);

  useFrame((_, delta) => {
    if (!flying) return;
    t.current += delta;
    const p = Math.min(1, t.current / DURATION);
    const fog = scene.fog as THREE.Fog | null;

    // bell-curve forward surge at eye height (no vertical motion)
    const speed = Math.sin(p * Math.PI) * 80;
    camera.position.addScaledVector(dir.current, speed * delta);
    camera.position.y = home.current.y;
    playerPos.x = camera.position.x;
    playerPos.z = camera.position.z;

    // tighten fog into a tunnel at the peak
    if (fog) {
      const tighten = Math.sin(p * Math.PI);
      fog.near = 2 + (1 - tighten) * 4;
      fog.far = 7 + (1 - tighten) * 11;
    }

    if (p >= 1) {
      // restore fog + view; <Player> teleports the capsule/camera to the arrived region
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
