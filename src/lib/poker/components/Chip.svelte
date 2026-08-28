<script>
  // A single casino chip, drawn in CSS (no image asset): a coloured body with
  // lighter edge spots, an inlay face, and a top gloss. Colour comes from the
  // amount so a bet/pot reads its rough size at a glance. Used for bet pills, the
  // pot, and the flying chips during betting / the showdown rake.
  import { chipTier, chipLabel } from "$lib/poker/chips.js";

  let { value = 0, size = 20, label = false } = $props();
  let t = $derived(chipTier(value));
  let lbl = $derived(label ? chipLabel(value) : "");
</script>

<span
  class="chip"
  style="--sz:{size}px; --base:{t.base}; --stripe:{t.stripe}; --rim:{t.rim}; --ink:{t.ink}"
  aria-hidden="true"
>
  {#if label}<span class="chip-lbl">{lbl}</span>{/if}
</span>

<style>
  .chip {
    display: inline-block;
    width: var(--sz); height: var(--sz);
    border-radius: 50%;
    position: relative;
    flex: 0 0 auto;
    /* body + evenly-spaced lighter edge spots */
    background: repeating-conic-gradient(
      from -15deg,
      var(--base) 0 22deg,
      var(--stripe) 22deg 30deg
    );
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.5),
      inset 0 0 0 1.5px color-mix(in srgb, var(--rim) 70%, #000 30%);
  }
  /* inlay face — covers the centre, leaving the edge-spot ring */
  .chip::before {
    content: "";
    position: absolute;
    inset: 20%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 36% 30%,
      color-mix(in srgb, var(--base) 72%, #fff 28%) 0%,
      var(--base) 52%,
      color-mix(in srgb, var(--base) 78%, #000 22%) 100%
    );
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--stripe) 55%, transparent);
  }
  /* top-left gloss for a rounded-plastic feel */
  .chip::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 46%);
    pointer-events: none;
  }
  .chip-lbl {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: calc(var(--sz) * 0.32);
    font-weight: 800;
    line-height: 1;
    color: var(--ink);
    z-index: 1;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  }
</style>
