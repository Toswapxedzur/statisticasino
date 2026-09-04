<script>
  // A single playing card — rendered entirely by OUR composer deck (composer.js:
  // our glyphs, pips, court figures, back). No external art, no async loading.
  // Detail scales with size: #1 small/hole (big numeral + suit), #3 board
  // (corner label + pips / courts) — the board form also serves large sizes.
  import { renderSmall, renderBoard, renderBack, renderEmpty, formFor } from "$lib/poker/composer.js";

  let { card = null, faceDown = false, size = "md" } = $props();

  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82, xl: 108 };
  let width = $derived(WIDTHS[size] ?? WIDTHS.md);

  let html = $derived.by(() => {
    if (faceDown) return renderBack(width);
    if (!card) return renderEmpty(width);
    return formFor(width) === 1 ? renderSmall(card, width) : renderBoard(card, width);
  });
</script>

{@html html}

<style>
  :global(.card-wrap) {
    display: inline-block; line-height: 0; vertical-align: top; border-radius: 7px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)); user-select: none;
    transform-origin: 50% 50%; backface-visibility: hidden;
  }
  :global(.card-wrap svg.card-svg) { display: block; border-radius: 6px; }
  :global(.card-wrap.empty) { opacity: 0.4; }
</style>
