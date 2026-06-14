# TODO

Roadmap and known rough edges for House of Entropy. Loosely ordered by impact.

## Polish (small, high value)
- [ ] **Textures / materials** — walls, floor, ceiling, book spines are flat colours. Add
      PBR or procedural textures (wood, stone, leather/paper) for atmosphere.
- [ ] **Book open/flip animation** — books currently snap open in front of the camera; add a
      pull-from-shelf + page-turn animation.
- [ ] **Search-result highlight** — re-add a (correctly aligned) highlight of the matched
      query within the page (removed earlier because the overlay drifted).
- [ ] **Tutorial book legibility** — the authored intro uses the same small font as full
      pages; give it its own larger layout.
- [ ] **Audio** — ambient hum, footsteps, page turns.

## Features
- [ ] **Shareable URLs** — encode the current coordinate / address in the URL so a link drops
      someone into the exact room or page (the original "URL = coordinate" goal).
- [ ] **Bookmarks** — save found pages/addresses locally.
- [ ] **"Leave body" zoom-out** — pull the camera up to see the hex lattice at scale.
- [ ] **Book image view** — render a page's bytes as an image (à la libraryofbabel.app).
- [ ] **Image / page search by upload** — find the page matching arbitrary uploaded content.

## Engine / correctness
- [ ] **Search arrival on a sealed centre** — when a searched hex is a centre, we nudge to a
      neighbour ring hex; verify the displayed coordinate still matches the opened page.
- [ ] **Address ↔ coordinate display parity** — confirm `addrToCoordString` and the BigInt
      coordinate readout agree for the same page.
- [ ] **Firefox / Safari BigInt limit** — these engines cap BigInt size; very deep pages may
      fail. Detect and warn, or cap gracefully.

## Performance
- [ ] **Geometry instancing/merging** — merge per-hex wall meshes; share one book material.
- [ ] **Tune `RING` / fog** per device; expose a quality setting.
- [ ] **Lazy/worker page generation** — move the ~4 ms BigInt page build off the main thread.

## Deploy / ops
- [ ] **CI** — typecheck + build on push.
- [ ] **Production deploy** — host at a public HTTPS URL (Coolify on the VPS, or Vercel).
