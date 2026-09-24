# design/sfx-review

Audition pages for the app's sound effects. Open the HTML files directly (file://);
none of this ships with the app. The shipped clips live in `static/sfx/`, named in
`src/lib/sfx.js`.

- `index.html` — every clip as shipped, with the source segment each one was cut from.
- `segments/` — the 203 silence-split ArtOrDie "Poker and Dice" segments (chips, cards,
  dice) the foley clips were chosen from.
- `nav-candidates.html` + `nav/` — 2026-09-06 round for the page-navigation sound.
- `zip-candidates.html` — 2026-09-24 rounds to replace the "zip" sounds (seat join/leave,
  call ended, error). Also published as a private artifact.
  - `zip/` — round 1, tonal options; rejected ("I'd like sound with no pitch").
  - `zip2/` — round 2, unpitched only. Owner picked sit/stand A (card-deck thumps),
    call ended 4 (phone power button), error 3 (dry dice double tick); those are now
    `static/sfx/{join,leave,call-off,error}`.
  - `now-*.mp3` in each round = the replaced zips, kept for comparison.
- `turn-candidates.html` + `turn/` — 2026-09-24 round for the "your turn" cue (was a rising
  four-note Kenney jingle). Unpitched only; owner picked 5 (Mixkit gear-lock tap), now
  `static/sfx/turn`. `now-turn.mp3` = the replaced jingle.

The candidate library these rounds draw from is `../sfx-library/` (1,591 licensed clips,
metadata in `rows.json`).
