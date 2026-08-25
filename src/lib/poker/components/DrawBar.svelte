<script>
  import { scale, fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Five-Card Draw action bar: tap cards to DISCARD, then Draw (or Stand pat).
  // Emits { type: "draw", discards: number[] }. Cards come from the private frame.

  let { cards = [], onAct = () => {} } = $props();

  const sig = $derived(cards.join(","));
  let discard = $state([]);
  $effect(() => { sig; discard = []; }); // reset on a fresh deal

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const toggle = (i) => (discard = discard.includes(i) ? discard.filter((x) => x !== i) : [...discard, i]);
</script>

<section class="drawbar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">Tap cards to discard, then Draw — or stand pat</div>
  <div class="cards">
    {#each cards as c, i (c + '-' + i)}
      <button class="dcard" class:disc={discard.includes(i)} onclick={() => toggle(i)}>
        <span class="face" class:red={c[1] === "d" || c[1] === "h"} in:scale={{ start: 0.6, duration: d(DUR.base), delay: d(i * 35) }}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
        <span class="tag">{discard.includes(i) ? "DISCARD" : "keep"}</span>
      </button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn btn-secondary" onclick={() => onAct({ type: "draw", discards: [] })}>Stand pat</button>
    <button class="btn primary" onclick={() => onAct({ type: "draw", discards: [...discard] })}>Draw {discard.length}</button>
  </div>
</section>

<style>
  .drawbar {
    max-width: 560px; margin: 8px auto 4px; padding: 14px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 12px;
  }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .cards { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .dcard {
    appearance: none; cursor: pointer; background: transparent;
    border-radius: var(--r-btn); padding: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px;
    transition: transform var(--dur) var(--ease);
  }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 8px; padding: 12px; font-weight: 800; font-size: 22px; line-height: 1;
    box-shadow: var(--shadow-card); min-width: 40px; justify-content: center;
    transition: box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
  }
  .face.red { color: var(--card-red); }
  .suit { font-size: 0.85em; }
  .tag { font-size: 10.5px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
  .dcard.disc .face { box-shadow: 0 0 0 3px var(--danger), var(--shadow-card); opacity: 0.6; }
  .dcard.disc .tag { color: var(--danger); font-weight: 800; }
  .acts { display: flex; gap: 12px; justify-content: center; }
</style>
