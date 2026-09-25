# design/deck-routine

Interactive demo of the dealer's opening routine (2026-09-25). Nothing here ships with the app;
it runs the real engine (`src/lib/poker/deck3d.js`) and timeline (`src/lib/poker/deck-routine.js`,
tests `deck-routine.test.js`).

- `index.html` — the demo: Play (a fresh routine each time: new cut points, shuffle and face-up
  card), speed 1×/½×/¼×, a frame scrubber, a phase bar. Published as a private artifact.
- `demo.js` — the demo script; `demo.bundle.js` is its esbuild bundle (`sh design/deck-routine/build.sh`
  from `statisticasino/`), which also refreshes `deck-parts/` from `static/deck-parts/`.

Owner's spec: face-up deck flies to the centre turning over and growing ~1.6×; cut three times;
split into two piles; cards fly one by one from the two piles to a third (the shuffle), the three
piles in a triangle; the third pile flies back and shrinks to its original size.
