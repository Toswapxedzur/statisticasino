<script>
  // A single playing card, rendered by the EXISTING Replay Poker deck
  // renderer (static/replay-engine/cards.js via window.CasinoCards) — the
  // same artwork the Data-page replay uses, so cards look identical across
  // the whole site. We do not draw our own card faces.
  //
  // `card` is a 2-char engine string ("As","Td"); the renderer's face
  // format matches the engine's exactly. `faceDown` shows the shared back
  // (X.png). No card + not face-down = an empty slot.
  import { onMount } from "svelte";
  import { loadCards } from "$lib/poker/cards-loader.js";

  let { card = null, faceDown = false, size = "md" } = $props();

  // Map size tokens to the renderer's pixel width (viewBox is 60x78).
  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82 };
  let width = $derived(WIDTHS[size] ?? WIDTHS.md);
  let height = $derived(Math.round((width * 78) / 60));

  let ready = $state(false);
  onMount(() => {
    loadCards().then(() => { ready = true; }).catch(() => { ready = false; });
  });

  // Recomputes when the renderer becomes ready or the inputs change.
  let html = $derived.by(() => {
    if (!ready || typeof window === "undefined" || !window.CasinoCards) return null;
    const C = window.CasinoCards;
    if (faceDown) return C.render("X", { width });
    if (!card) return C.empty({ width });
    return C.render(card, { width });
  });
</script>

{#if html}
  {@html html}
{:else}
  <!-- Placeholder before the classic renderer finishes loading (keeps
       layout stable so cards don't pop the felt around). -->
  <span
    class="card-loading"
    class:back={faceDown}
    style="width:{width}px;height:{height}px"
    aria-hidden="true"
  ></span>
{/if}

<style>
  /* Card renderer output styling, copied from replay-felt.css so the
     table page doesn't need to load the whole felt stylesheet. */
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
  :global(.card-wrap.empty) { opacity: 0.4; }

  .card-loading {
    display: inline-block;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.14);
    box-sizing: border-box;
  }
  .card-loading.back {
    background: #17263a;
    border-style: solid;
    border-color: rgba(255, 255, 255, 0.12);
  }
</style>
