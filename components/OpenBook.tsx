"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { useOpenState, closeBook, turnPage } from "./bookStore";
import { pageTextBig, pageLines, isTutorialBook, tutorialPages } from "@/lib/library";

// Portrait pages (book-like). Each page shows ~26 lines of the page text, wrapped to the
// page width, at a comfortably readable size.
const PAGE_W = 0.72; // width of one page plane (metres, in view)
const PAGE_H = 0.96;
const PAGE_FONT = 0.026;
const PAGE_COLS = 40; // chars shown per line (page wrapped to this width)
const PAGE_ROWS = 30; // lines shown per page
const DIST = 1.35; // how far in front of the camera the book floats

export function OpenBook() {
  const open = useOpenState();
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);

  // Build the two visible half-pages from whichever source is open.
  // For a search result we also locate the query so it can be highlighted.
  const text = useMemo(() => {
    if (!open) return null;
    // Reflow the raw page (80-char lines) into narrower PAGE_COLS lines so the spread reads
    // like a portrait book; left page = first PAGE_ROWS lines, right page = next PAGE_ROWS.
    const reflow = (raw: string) => {
      const flat = pageLines(raw).join("");
      const out: string[] = [];
      for (let i = 0; i < flat.length; i += PAGE_COLS) out.push(flat.slice(i, i + PAGE_COLS));
      return out;
    };
    if (open.kind === "coord" && isTutorialBook(open.coord)) {
      const t = tutorialPages();
      return { left: t.left, right: t.right };
    }
    const raw = open.kind === "coord" ? pageTextBig(open.coord) : open.result.text;
    const lines = reflow(raw);
    return {
      left: lines.slice(0, PAGE_ROWS).join("\n"),
      right: lines.slice(PAGE_ROWS, PAGE_ROWS * 2).join("\n"),
    };
  }, [open]);

  // Keyboard: arrows flip (coord books only), Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowRight") turnPage(2);
      else if (e.code === "ArrowLeft") turnPage(-2);
      else if (e.code === "Escape") closeBook();
    };
    window.addEventListener("keydown", onKey);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the book pinned in front of the camera each frame.
  useFrame(() => {
    if (!group.current || !open) return;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const pos = camera.position.clone().add(dir.multiplyScalar(DIST));
    group.current.position.copy(pos);
    group.current.quaternion.copy(camera.quaternion);
  });

  if (!open || !text) return null;

  // renderOrder + depthTest:false make the book draw on top of the world (no wall clipping).
  const onTop = { depthTest: false, depthWrite: false } as const;

  return (
    <group ref={group} renderOrder={999}>
      {/* book back board */}
      <mesh renderOrder={999}>
        <boxGeometry args={[PAGE_W * 2 + 0.12, PAGE_H + 0.12, 0.05]} />
        <meshBasicMaterial color="#2c1f14" {...onTop} />
      </mesh>
      {/* two page planes */}
      <mesh position={[-PAGE_W / 2 - 0.015, 0, 0.03]} renderOrder={1000}>
        <planeGeometry args={[PAGE_W, PAGE_H]} />
        <meshBasicMaterial color="#e8e0cf" {...onTop} />
      </mesh>
      <mesh position={[PAGE_W / 2 + 0.015, 0, 0.03]} renderOrder={1000}>
        <planeGeometry args={[PAGE_W, PAGE_H]} />
        <meshBasicMaterial color="#e8e0cf" {...onTop} />
      </mesh>

      {/* page text — anchored top-left of each page, sized so 80×20 fills the page */}
      <Text
        position={[-(PAGE_W + 0.015) + 0.02, PAGE_H / 2 - 0.02, 0.04]}
        renderOrder={1001}
        fontSize={PAGE_FONT}
        color="#241c12"
        anchorX="left"
        anchorY="top"
        textAlign="left"
        lineHeight={1.18}
        material-depthTest={false}
      >
        {text.left}
      </Text>

      <Text
        position={[0.015 + 0.02, PAGE_H / 2 - 0.02, 0.04]}
        renderOrder={1001}
        fontSize={PAGE_FONT}
        color="#241c12"
        anchorX="left"
        anchorY="top"
        textAlign="left"
        lineHeight={1.18}
        material-depthTest={false}
      >
        {text.right}
      </Text>
    </group>
  );
}
