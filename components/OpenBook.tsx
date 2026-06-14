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
      const ll = t.left.split("\n");
      const rl = t.right.split("\n");
      return { left: ll, right: rl, leftMark: ll.map(() => ""), rightMark: rl.map(() => "") };
    }
    // Both kinds regenerate from the (BigInt) coordinate, so flipping a search book works the
    // same as a normal book. For a search, the manufactured query page IS pageTextBig(coord).
    const raw = pageTextBig(open.coord);
    const lines = reflow(raw);
    // Per-line highlight MASK: a parallel string where only the exact query columns carry the
    // query character and everything else is a space. Reflow is char-for-char identity on the
    // flat page, so raw index i -> reflow row floor(i/PAGE_COLS), col i%PAGE_COLS. The mask is
    // drawn as a gold box behind exactly those columns. Only shown on the page the query lives
    // on, so flipping to other pages of the book shows them un-highlighted.
    const mark: string[] = lines.map((ln) => " ".repeat(ln.length));
    if (open.kind === "search" && open.coord.page === open.homePage) {
      for (const idx of open.result.spans) {
        const row = Math.floor(idx / PAGE_COLS);
        const col = idx % PAGE_COLS;
        const m = mark[row];
        if (m === undefined) continue;
        mark[row] = m.slice(0, col) + open.result.text[idx] + m.slice(col + 1);
      }
    }
    return {
      left: lines.slice(0, PAGE_ROWS),
      right: lines.slice(PAGE_ROWS, PAGE_ROWS * 2),
      leftMark: mark.slice(0, PAGE_ROWS),
      rightMark: mark.slice(PAGE_ROWS, PAGE_ROWS * 2),
    };
  }, [open]);

  // Keyboard: arrows flip pages (coord + search books), Esc closes.
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

      {/* page text — one <Text> per line; query glyphs get a gold box behind them */}
      <PageLines lines={text.left} marks={text.leftMark} x={-(PAGE_W + 0.015) + 0.02} />
      <PageLines lines={text.right} marks={text.rightMark} x={0.015 + 0.02} />
    </group>
  );
}

const LINE_STEP = PAGE_FONT * 1.18; // vertical advance per line (matches lineHeight)
const TOP = PAGE_H / 2 - 0.02;
const ADV = PAGE_FONT * 0.6; // JetBrains Mono advance width (600/1000 em) — exact in monospace
const MONO = "/mono.woff";

// Contiguous runs of non-space columns in a mask line -> [startCol, length].
function runsOf(mark: string): [number, number][] {
  const runs: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= mark.length; i++) {
    const on = i < mark.length && mark[i] !== " ";
    if (on && s < 0) s = i;
    else if (!on && s >= 0) { runs.push([s, i - s]); s = -1; }
  }
  return runs;
}

// Render a half-page line-by-line in a monospace font. For each query run, draw a gold box
// behind exactly those columns (column math is exact because the font is monospace).
function PageLines({ lines, marks, x }: { lines: string[]; marks: string[]; x: number }) {
  return (
    <>
      {lines.map((ln, i) => {
        const y = TOP - i * LINE_STEP;
        const runs = marks[i] ? runsOf(marks[i]) : [];
        return (
          <group key={i}>
            {runs.map(([col, len], k) => (
              <mesh
                key={k}
                position={[x + (col + len / 2) * ADV, y - PAGE_FONT * 0.5, 0.038]}
                renderOrder={1000}
              >
                <planeGeometry args={[len * ADV, PAGE_FONT * 1.05]} />
                <meshBasicMaterial color="#f4d98b" depthTest={false} depthWrite={false} transparent opacity={0.8} />
              </mesh>
            ))}
            <Text
              position={[x, y, 0.04]}
              renderOrder={1001}
              font={MONO}
              fontSize={PAGE_FONT}
              color="#241c12"
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
