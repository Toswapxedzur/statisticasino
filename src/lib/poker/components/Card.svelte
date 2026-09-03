<script>
  // A single playing card. The felt uses the original Replay Poker deck
  // (window.CasinoCards); on the #3 (board) form we keep Replay's body (pips +
  // court) and swap OUR own number+suit label into the corner. Small cards use
  // our own composed form. See composer.js.
  import { onMount } from "svelte";
  import { loadCards } from "$lib/poker/cards-loader.js";
  import { renderSmall, renderBoard, formFor } from "$lib/poker/composer.js";

  let { card = null, faceDown = false, size = "md" } = $props();

  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82, xl: 108 };
  let width = $derived(WIDTHS[size] ?? WIDTHS.md);
  let height = $derived(Math.round((width * 78) / 60));

  let ready = $state(false);
  onMount(() => {
    loadCards().then(() => { ready = true; }).catch(() => { ready = false; });
  });

  let html = $derived.by(() => {
    if (!ready || typeof window === "undefined" || !window.CasinoCards) return null;
    const C = window.CasinoCards;
    if (faceDown) return C.render("X", { width });
    if (!card) return C.empty({ width });
    const form = formFor(width);
    if (form === 1) return renderSmall(card, width); // #1 our composed small/hole card
    if (form === 3) return renderBoard(card, width); // #3 our own Replay-style board card
    return C.render(card, { width }); // #4 full Replay card
  });
</script>

{#if html}
  {@html html}
{:else}
  <span class="card-loading" class:back={faceDown} style="width:{width}px;height:{height}px" aria-hidden="true"></span>
{/if}

<style>
  :global(.card-wrap) {
    display: inline-block; line-height: 0; vertical-align: top; border-radius: 7px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)); user-select: none;
    transform-origin: 50% 50%; backface-visibility: hidden;
  }
  :global(.card-wrap svg.card-svg) { display: block; border-radius: 6px; }
  :global(.card-wrap.empty) { opacity: 0.4; }
  .card-loading {
    display: inline-block; border-radius: 7px; background: var(--well);
    box-shadow: var(--shadow-card); box-sizing: border-box;
  }
</style>
