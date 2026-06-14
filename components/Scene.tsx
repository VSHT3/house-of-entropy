"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { HexGrid } from "./HexGrid";
import { Player } from "./Player";
import { OpenBook } from "./OpenBook";
import { FlyThrough } from "./FlyThrough";
import { WALL_HEIGHT } from "@/lib/babel";
import { playerPos } from "./playerState";

// Flip to true to inspect geometry with an orbit camera and no first-person player.
const DEBUG = false;

// A single warm lamp that follows the player near the ceiling — replaces a per-hex light
// (dozens of dynamic point lights was the main perf cost).
function FollowLamp() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.set(playerPos.x, WALL_HEIGHT - 0.5, playerPos.z);
  });
  return <pointLight ref={ref} intensity={26} distance={18} decay={1.4} color="#ffd9a0" />;
}

export function Scene() {
  return (
    <Canvas
      camera={{ fov: 75, near: 0.1, far: 100, position: DEBUG ? [10, 8, 10] : [0, 1.9, 0] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#0a0807"]} />
      {!DEBUG && <fog attach="fog" args={["#0a0807", 6, 20]} />}

      <ambientLight intensity={0.55} />
      {!DEBUG && <FollowLamp />}

      <Physics gravity={[0, -9.81, 0]} debug={DEBUG}>
        <HexGrid />
        {DEBUG ? <OrbitControls /> : <Player />}
      </Physics>

      <OpenBook />
      <FlyThrough />
    </Canvas>
  );
}
