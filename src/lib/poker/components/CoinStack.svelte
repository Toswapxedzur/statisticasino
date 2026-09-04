<script>
  // A bet/pot rendered as a PILE of coins: the amount is greedily broken into
  // tier denominations (the coin ladder's mins), one column per denomination,
  // coins stacked upward with a small rise. Highest denominations first; wide
  // amounts are capped to the biggest columns (the exact number is always shown
  // as adjacent text by the caller).
  import Chip from "./Chip.svelte";

  let { value = 0, size = 20, maxCols = 5, maxPer = 5 } = $props();

  const DENOMS = [5000000, 1000000, 250000, 50000, 10000, 2500, 500, 100, 25, 5, 1];
  const RISE = 0.22; // fraction of coin size each stacked coin rises

  let cols = $derived.by(() => {
    let n = Math.max(0, Math.floor(Number(value) || 0));
    const out = [];
    for (const d of DENOMS) {
      if (n >= d) {
        const count = Math.floor(n / d);
        n -= count * d;
        out.push({ denom: d, count: Math.min(count, maxPer) });
      }
    }
    return out.slice(0, maxCols);
  });
  let rise = $derived(Math.max(2, Math.round(size * RISE)));
</script>

<span class="cstack" style="--sz:{size}px; --rise:{rise}px" aria-hidden="true">
  {#each cols as c (c.denom)}
    <span class="ccol" style="height:{size + (c.count - 1) * rise}px">
      {#each Array(c.count) as _, k}
        <span class="cc" style="--k:{k}"><Chip value={c.denom} size={size} /></span>
      {/each}
    </span>
  {/each}
</span>

<style>
  .cstack {
    display: inline-flex;
    align-items: flex-end;
    flex: 0 0 auto;
  }
  .ccol {
    position: relative;
    width: var(--sz);
    display: inline-block;
    flex: 0 0 auto;
  }
  .ccol + .ccol { margin-left: calc(var(--sz) * -0.16); }
  .cc {
    position: absolute;
    left: 0;
    bottom: calc(var(--k) * var(--rise));
    display: block;
    line-height: 0;
  }
</style>
