# design/card-back-review

Survey of open-source playing-card backs (2026-09-25), to pick the back for the deal/flip
animation. Nothing here ships with the app.

- `index.html` — the gallery: every back large and at in-game size, on a dark or light
  table ground, click-to-shortlist. Also published as a private artifact.
- `manifest.json` — one entry per back: id, licence group, name, source, licence, file, caveat.
- `backs/` — the images, named by id:
  - `R2` the old navy back (composer.js before 2026-09-25). The casino.org back (`R1` in the
    published page) is NOT stored here — proprietary; recover it from git `278c513^` if needed.
  - CC0: `K1–K7` Adrian Kennard generator (Goodall, Diamond, Maze, Illusion, Arrows, Marked,
    Plain), `N1–N10` Nicu Buculei, `D1–D15` BdRGames, `Y1–Y15` Kenney Boardgame Pack,
    `S1–S6` Sylly, `C1–C9` Wikimedia Commons and others.
  - `M1` MIT (MattCain). `E1` CC-BY (Sharm, downscaled from 3000×4200).
  - LGPL: `L01–L17` David Bellot (Commons; logo backs 07/08/10/12 left out),
    `HB/HR/HK/HG` Bellot SVG-cards medallion, `A1` Chris Aguilar sheet.

Sources, URLs and licence caveats: project memory `card-backs.md`. Raw downloads were kept
in the session scratchpad only.

**Decision 2026-09-25:** owner picked `S5` (Sylly red 1) → shipped as
`static/deck-parts/back-sylly-red.svg` (red panel only, inside our own card frame).
