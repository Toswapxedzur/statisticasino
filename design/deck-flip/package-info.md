# design/deck-flip

Interactive demo of the whole 52-card deck turning over (2026-09-25). Nothing here ships with
the app; the engine it runs is `src/lib/poker/deck3d.js` (tests: `deck3d.test.js`).

- `index.html` — the demo: Flip button (alternates face down/up, new random bottom card each
  time), slow motion ×¼, a frame scrubber, live θ/ω/α/angular momentum/torque/lift/clearance,
  and the curves of one flip. Published as a private artifact.
- `demo.js` — the demo script; `demo.bundle.js` is its esbuild bundle (`sh design/deck-flip/build.sh`
  from `statisticasino/`), which also refreshes `deck-parts/` from `static/deck-parts/`.

Owner's spec: side-over (about the long axis, like a page), lifted and flipped in place, random
card face on the bottom, ~0.9 s, smooth with the angular motion computed (minimum-jerk).
