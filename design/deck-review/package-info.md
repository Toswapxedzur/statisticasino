# design/deck-review

Review page for the dealer's deck at rest (2026-09-25). Nothing here ships with the app.

- `index.html` — the deck drawn by the real renderer (`composer.renderDeck`) at 52/26/13/5/1
  cards, at 82 px and 60 px on both table grounds, plus a 320 px close-up. Published as a
  private artifact.
- `build.mjs` — regenerates `index.html` from composer.js (`node design/deck-review/build.mjs`
  from `statisticasino/`).
- `deck-parts/` — copies of the card art the page references by relative path.

Owner's spec: one flat top card + the stack's front edge as grey/white strips, band 0.21 × card
height for 52 cards (first 0.3, then cards 30% thinner), shrinking with the cards left.
