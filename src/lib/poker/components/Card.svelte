<script>
  // A single playing card, assembled by the composer ($lib/poker/composer.js)
  // from the extracted real Aguilar glyphs, laid out by our size rule:
  //   ① hero (big numeral + suit) · ② diagonal · ③ full real card · ④ four-corner.
  //
  //  card     — 2-char engine string ("As","Td"); null = empty slot.
  //  faceDown — show the card back.
  //  size     — layout token → render width (drives which design ①–④).
  import { renderFace, renderBack, renderEmpty } from "$lib/poker/composer.js";

  let { card = null, faceDown = false, size = "md" } = $props();

  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82, xl: 108 };
  let width = $derived(WIDTHS[size] ?? WIDTHS.md);

  let html = $derived.by(() => {
    if (faceDown) return renderBack(width);
    if (!card) return renderEmpty(width);
    return renderFace(card, { width });
  });
</script>

{@html html}

<style>
  /* the composer emits .rvcard (svg or img); @html output isn't scoped, so
     these are global. */
  :global(.rvcard) {
    display: block;
    line-height: 0;
    vertical-align: top;
    border-radius: 5px;
    user-select: none;
    -webkit-user-drag: none;
    backface-visibility: hidden;
  }
  :global(.rvcard.face) {
    background: #fff;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  }
  :global(.rvcard.back) {
    background: transparent;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  }
  :global(.rvcard.empty) {
    color: var(--muted, #8ea3bd);
    filter: none;
  }
</style>
