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
  // For a search result we also locate which reflowed lines hold the query so they can be
  // highlighted (computed from exact char indices — no regex, so spaces/punctuation are safe).
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
      return { left: t.left.split("\n"), right: t.right.split("\n"), hits: new Set<number>() };
    }
    const raw = open.kind === "coord" ? pageTextBig(open.coord) : open.result.text;
    const lines = reflow(raw);
    // Reflow is char-for-char identity on the flat page, so a raw char index maps to reflow
    // row = floor(idx / PAGE_COLS). Mark every row the query touches.
    const hits = new Set<number>();
    if (open.kind === "search") {
      for (const idx of open.result.spans) hits.add(Math.floor(idx / PAGE_COLS));
    }
    return {
      left: lines.slice(0, PAGE_ROWS),
      right: lines.slice(PAGE_ROWS, PAGE_ROWS * 2),
      hits,
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

      {/* page text — one <Text> per line so query lines can be tinted + back-lit */}
      <PageLines lines={text.left} hits={text.hits} rowBase={0} x={-(PAGE_W + 0.015) + 0.02} />
      <PageLines lines={text.right} hits={text.hits} rowBase={PAGE_ROWS} x={0.015 + 0.02} />
    </group>
  );
}

const LINE_STEP = PAGE_FONT * 1.18; // vertical advance per line (matches lineHeight)
const TOP = PAGE_H / 2 - 0.02;

// Render a half-page line-by-line. Rows whose reflow index is in `hits` (query lines) get an
// accent colour and a faint highlight strip behind them.
function PageLines({ lines, hits, rowBase, x }: { lines: string[]; hits: Set<number>; rowBase: number; x: number }) {
  return (
    <>
      {lines.map((ln, i) => {
        const hit = hits.has(rowBase + i);
        const y = TOP - i * LINE_STEP;
        return (
          <group key={i}>
            {hit && ln.trim().length > 0 && (
              <mesh position={[x + PAGE_W / 2 - 0.025, y - PAGE_FONT * 0.45, 0.038]} renderOrder={1000}>
                <planeGeometry args={[PAGE_W - 0.04, PAGE_FONT * 1.12]} />
                <meshBasicMaterial color="#f4d98b" depthTest={false} depthWrite={false} transparent opacity={0.7} />
              </mesh>
            )}
            <Text
              position={[x, y, 0.04]}
              renderOrder={1001}
              fontSize={PAGE_FONT}
              color={hit ? "#5a3a12" : "#241c12"}
              anchorX="left"
              anchorY="top"
              textAlign="left"
              lineHeight={1.18}
              material-depthTest={false}
            >
              {ln}
            </Text>
          </group>
        );
      })}
    </>
  );
}
