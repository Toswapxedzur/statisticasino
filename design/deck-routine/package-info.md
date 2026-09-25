# design/deck-routine

Interactive demo of the dealer's opening routine (2026-09-25). Nothing here ships with the app;
it runs the real engine (`src/lib/poker/deck3d.js`) and timeline (`src/lib/poker/deck-routine.js`,
tests `deck-routine.test.js`).

- `index.html` — the demo: Play (a fresh routine each time: new cut points, shuffle and face-up
  card), speed 1×/½×/¼×, a frame scrubber, a phase bar. Published as a private artifact.
- `demo.js` — the demo script; `demo.bundle.js` is its esbuild bundle (`sh design/deck-routine/build.sh`
  from `statisticasino/`), which also refreshes `deck-parts/` from `static/deck-parts/`.

Owner's spec: real-game spots — face-down deck top-left, face-up used pile top-right, both just
below the top bar. The used pile flies to the centre turning over and growing ~1.6×; three
middle-section cuts (a random middle section slides out horizontally, flat U-turn 1.5 card-widths
out, back horizontally on top; the top section lands exactly as the middle's left edge touches the
deck's right edge); split into two piles; cards fly one by one to a third pile (the triangle
shuffle); the deck flies to the top-left and shrinks to its original size.
