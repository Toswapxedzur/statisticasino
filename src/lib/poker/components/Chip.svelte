<script>
  // A single metal coin — see chips.js `coinSvg` for the drawing (angled disc
  // with depth, flat colours, top-left lit region; detail scales with size).
  // The metal comes from the amount; the amount itself is shown as adjacent
  // text by the caller, not on the coin.
  import { coinSvg } from "$lib/poker/chips.js";

  let { value = 0, size = 20 } = $props();
</script>

<span class="coin" style="--sz:{size}px" aria-hidden="true">{@html coinSvg(value, size)}</span>

<style>
  .coin {
    display: inline-block;
    width: var(--sz);
    height: var(--sz);
    flex: 0 0 auto;
    line-height: 0;
    filter: drop-shadow(0 calc(var(--sz) * 0.03) calc(var(--sz) * 0.05) rgba(0, 0, 0, 0.45));
  }
  .coin :global(svg) { display: block; }
</style>
