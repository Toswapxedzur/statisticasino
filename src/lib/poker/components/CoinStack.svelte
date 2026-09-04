<script>
  // A bet/pot rendered as a PILE of coins: the amount is greedily broken into
  // tier denominations (the coin ladder's mins), one column per denomination,
  // coins stacked upward with a small rise. Highest denominations first; wide
  // amounts are capped to the biggest columns (the exact number is always shown
  // as adjacent text by the caller).
  import Chip from "./Chip.svelte";

  let { value = 0, size = 20, maxCols = 5, maxPer = 5 } = $props();

  const DENOMS = [5000000, 1000000, 250000, 50000, 10000, 2500, 500, 100, 25, 5, 1];
  // Realistic pile: each coin rises only by its edge thickness (a tight sliver).
  // Columns pack at half-coin pitch and alternate front/back rows in a 60°
  // triangular (hex) packing: pitch p = 0.5·size, equilateral offset √3·p
  // squashed by the coin tilt (0.696) → zig ≈ 0.6·size. Back row sits behind.
  const RISE = 0.14; // fraction of coin size each stacked coin rises

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
  {#each cols as c, i (c.denom)}
    <span class="ccol" class:hi={i % 2 === 1} style="height:{size + (c.count - 1) * rise}px">
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
    /* headroom for the back (zig-raised) row */
    padding-top: calc(var(--sz) * 0.6);
  }
  .ccol {
    position: relative;
    width: var(--sz);
    display: inline-block;
    flex: 0 0 auto;
  }
  /* tight 60° zig-zag: half-coin pitch; back row raised √3·pitch·tilt ≈ 0.6·size
     and drawn BEHIND the front row */
  .ccol { z-index: 2; }
  .ccol + .ccol { margin-left: calc(var(--sz) * -0.5); }
  .ccol.hi { transform: translateY(calc(var(--sz) * -0.6)); z-index: 1; }
  .cc {
    position: absolute;
    left: 0;
    bottom: calc(var(--k) * var(--rise));
    display: block;
    line-height: 0;
  }
</style>
