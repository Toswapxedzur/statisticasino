<script>
  // A single playing card for the redesigned felt, drawn by the Riverside
  // vector deck ($lib/poker/deck.js) — pure SVG, no async load, no PNGs, so
  // it renders identically on the server and client and never flashes in.
  // (The /data replay page keeps the classic window.CasinoCards deck; this
  // component is table-only.)
  //
  //  card     — 2-char engine string ("As","Td"); null = empty slot.
  //  faceDown — show the shared card back.
  //  size     — layout token; maps to a render width, which drives the deck's
  //             size rule (smaller ⇒ bigger index, less detail).
  import { renderFace, renderBack, renderEmpty } from "$lib/poker/deck.js";

  let { card = null, faceDown = false, size = "md" } = $props();

  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82, xl: 108 };
  let width = $derived(WIDTHS[size] ?? WIDTHS.md);

  let html = $derived.by(() => {
    if (faceDown) return renderBack({ width });
    if (!card) return renderEmpty({ width });
    return renderFace(card, { width });
  });
</script>

{@html html}

<style>
  /* Deck theme tokens — the vector deck ($lib/poker/deck.js) paints with
     these, so it follows the app's light/dark theme (and switches live). */
  :global(:root) {
    --rvc-face-a: #20304e;   /* face gradient top */
    --rvc-face-b: #111c31;   /* face gradient bottom */
    --rvc-edge: #38496b;     /* card border */
    --rvc-inner: #ffffff14;  /* inner hairline */
    --rvc-ink: #e7eef9;      /* spades/clubs + rank */
    --rvc-red: #ff5b52;      /* hearts/diamonds */
    --rvc-panel: #27385a;    /* court panel fill */
  }
  :global(:root[data-theme="light"]) {
    --rvc-face-a: #ffffff;
    --rvc-face-b: #f6f4ec;
    --rvc-edge: #e4e0d4;
    --rvc-inner: #00000010;
    --rvc-ink: #16294d;
    --rvc-red: #c4142b;
    --rvc-panel: #fffdf8;
  }

  /* Deck output styling. The renderer emits <span class="card-wrap"><svg
     class="card-svg">…</svg></span>; these rules give the card its rounded
     silhouette + lift. */
  :global(.card-wrap) {
    display: inline-block;
    line-height: 0;
    vertical-align: top;
    border-radius: 7px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
    user-select: none;
    transform-origin: 50% 50%;
    backface-visibility: hidden;
  }
  :global(.card-wrap svg.card-svg) {
    display: block;
    border-radius: 6px;
  }
  :global(.card-wrap.empty) {
    color: var(--muted, #8ea3bd);
    filter: none;
  }
  :global(.card-wrap.back) {
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  }
</style>
