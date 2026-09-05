# design/logo-candidates

Round-1 Riverside logo candidates (2026-09-05): coins + suits + rank glyphs in faux-3D
(flat colours, extruded offset copies for depth, clipped lit region — no gradients).
`gen.mjs` regenerates every `*.svg` and `sheet.svg` from our own assets
(`src/lib/poker/deck-parts.js` glyphs, coin tier palette). Render the sheet with
headless Chrome (`--screenshot --window-size=2700,1180`); QuickLook mis-scales it.
Not wired into the app; the chosen direction gets refined and then moved to `static/`.
