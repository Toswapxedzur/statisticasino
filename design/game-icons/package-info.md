# design/game-icons — the 8 game icons

- `icons.js` — the icons, drawn as SVG on a 96×96 grid. Owner's rules (2026-09-26): only the six warm
  tones (ebony #1C1A15 · charcoal #3E3A31 · gray #6E685B · white #FBF8EF · cream #F1E9D3 · ivory
  #E1D3AD), no borders, no thin lines, no letters/numbers, no card elements; lit from the upper left
  with hard-edged stepped tones inside one family (`shade()`).
- `build.mjs` — writes `static/games/<key>.svg` (used by the lobby tabs, table cards, table header via
  `gameIcon()` in `src/lib/poker/games.js`). Run `node design/game-icons/build.mjs` after editing.
- `sheet.mjs` → `sheet.html` / `sheet.png` — preview on navy, light and small.
- `tabs-mock.mjs` → `tabs-mock.png` — the three lobby-tab arrangements; the owner chose B (icon over
  name, 8 across / 4×2 on a phone).
- `sprint.js` + `sprint-sheet.mjs` → `sprint-sheet.png` — the River Sprint icon: three candidates; the
  owner chose the stopwatch (river waves low on a dark face, touching; a white crescent moon centred in
  the open space; `sprint-stopwatch.png`). Not wired into the site yet.
