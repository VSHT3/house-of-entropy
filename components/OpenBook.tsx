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

  // Keep the book pinned in front of the camera each frame. We pitch it back (top edge tilts
  // away) and drop it below eyeline so the reader looks DOWN onto a held book — that viewing
  // angle, not the page V alone, is what makes the spread read as a 3D object.
  const tilt = useMemo(() => new THREE.Quaternion(), []);
  useFrame(() => {
    if (!group.current || !open) return;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const down = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion); // camera-up
    const pos = camera.position
      .clone()
      .add(dir.multiplyScalar(DIST))
      .addScaledVector(down, -0.16); // sit slightly low, like held up to read
    group.current.position.copy(pos);
    // camera orientation, then a gentle pitch back about its local X. Small angle keeps the
    // spread reading nearly flat-on (legible, no strong trapezoid keystone) while still 3D.
    tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.22);
    group.current.quaternion.copy(camera.quaternion).multiply(tilt);
  });

  if (!open || !text) return null;

  // renderOrder + depthTest:false make the book draw on top of the world (no wall clipping).
  // fog:false keeps the unlit page-white from being washed brown by the scene fog at DIST.
  const onTop = { depthTest: false, depthWrite: false, fog: false } as const;
  // Open-book V: each page leaf tilts away from the centre spine so the spread reads as a real
  // 3D open volume rather than a flat card. The page block also has real thickness behind it.
  const OPEN = 0.06; // half-angle of the V (radians); small = nearly-flat, aligned spread
  const COVER_OVER = 0.06; // how far the leather cover oversizes the pages
  const THICK = 0.10; // page-block thickness (the wad of pages)

  return (
    <group ref={group}>
      {/* leather back board / cover — UNLIT basic (the follow-lamp must not tint it brown over
          the pages). Sits well behind the page block, lowest renderOrder. */}
      <mesh position={[0, 0, -THICK / 2 - 0.02]} renderOrder={990}>
        <boxGeometry args={[PAGE_W * 2 + COVER_OVER * 2, PAGE_H + COVER_OVER * 2, 0.06]} />
        <meshBasicMaterial color="#3a281a" toneMapped={false} {...onTop} />
      </mesh>
      {/* spine ridge down the centre */}
      <mesh position={[0, 0, -0.01]} renderOrder={991}>
        <boxGeometry args={[0.05, PAGE_H + COVER_OVER * 2, THICK + 0.06]} />
        <meshBasicMaterial color="#2c1d12" toneMapped={false} {...onTop} />
      </mesh>

      {/* LEFT leaf: pivots at the spine (x=0), tilts open toward the reader */}
      <group rotation={[0, OPEN, 0]}>
        <Leaf side={-1} w={PAGE_W} h={PAGE_H} thick={THICK} onTop={onTop} />
        <PageLines lines={text.left} marks={text.leftMark} x={-PAGE_W + 0.04} />
      </group>
      {/* RIGHT leaf */}
      <group rotation={[0, -OPEN, 0]}>
        <Leaf side={1} w={PAGE_W} h={PAGE_H} thick={THICK} onTop={onTop} />
        <PageLines lines={text.right} marks={text.rightMark} x={0.04} />
      </group>
    </group>
  );
}

// Gutter shadow texture: a horizontal gradient, opaque-brown at u=1 fading to fully
// transparent at u=0. Built once. Placed so its dark end hugs the spine on each leaf.
let _gutterTex: THREE.CanvasTexture | null = null;
function gutterTex(): THREE.CanvasTexture {
  if (_gutterTex) return _gutterTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(40,28,18,0)");
  g.addColorStop(0.7, "rgba(40,28,18,0.15)");
  g.addColorStop(1, "rgba(30,20,12,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  _gutterTex = new THREE.CanvasTexture(c);
  _gutterTex.colorSpace = THREE.SRGBColorSpace;
  return _gutterTex;
}

// One page leaf: a thin slab of pages (paper edge visible) topped by the cream reading surface.
// `side` is -1 (left) / +1 (right); the leaf grows outward from the spine at local x=0.
function Leaf({
  side,
  w,
  h,
  thick,
  onTop,
}: {
  side: number;
  w: number;
  h: number;
  thick: number;
  onTop: { depthTest: boolean; depthWrite: boolean };
}) {
  const cx = side * (w / 2 + 0.01);
  return (
    <group>
      {/* the wad of pages (gives the leaf depth + a visible paper edge). Unlit basic material
          so the lamp can't dim it to brown — pages stay bright from every angle.
          toneMapped:false keeps the page from being crushed by the renderer's tone curve. */}
      <mesh position={[cx, 0, -thick / 2]} renderOrder={999}>
        <boxGeometry args={[w, h, thick]} />
        <meshBasicMaterial color="#e7e0cd" toneMapped={false} {...onTop} />
      </mesh>
      {/* the printed reading surface — warm ivory, not clinical white. */}
      <mesh position={[cx, 0, 0.002]} renderOrder={1000}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#f7f1e2" toneMapped={false} {...onTop} />
      </mesh>
      {/* soft gutter shadow: paper curves into the spine, so darken the inner margin with a
          horizontal gradient (dark at the spine, fading out toward the page). scale.x flips the
          gradient so the dark end always hugs the spine on either leaf. */}
      <mesh position={[side * 0.09, 0, 0.003]} scale={[-side, 1, 1]} renderOrder={1001}>
        <planeGeometry args={[0.18, h]} />
        <meshBasicMaterial map={gutterTex()} transparent opacity={0.55} toneMapped={false} {...onTop} />
      </mesh>
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
                position={[x + (col + len / 2) * ADV, y - PAGE_FONT * 0.5, 0.006]}
                renderOrder={1001}
              >
                <planeGeometry args={[len * ADV, PAGE_FONT * 1.05]} />
                <meshBasicMaterial color="#f4d98b" depthTest={false} depthWrite={false} fog={false} transparent opacity={0.8} />
              </mesh>
            ))}
            <Text
              position={[x, y, 0.008]}
              renderOrder={1002}
              font={MONO}
              fontSize={PAGE_FONT}
              color="#241c12"
              anchorX="left"
              anchorY="top"
              textAlign="left"
              lineHeight={1.18}
              material-depthTest={false}
              material-fog={false}
            >
              {ln}
            </Text>
          </group>
        );
      })}
    </>
  );
}
