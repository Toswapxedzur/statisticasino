<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Video Poker controls. Cards are held by tapping them under your seat badge;
  // `selected` holds the held indices. Emits { type: "draw", holds: [bool × 5] }.
  let { turn, selected = [], onAct = () => {} } = $props();

  const bet = $derived(turn?.bet || 0);
  const n = $derived((turn?.cards || []).length || 5);
  function draw() { onAct({ type: "draw", holds: Array.from({ length: n }, (_, i) => selected.includes(i)) }); }
</script>

<section class="bar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">bet {bet.toLocaleString()} · tap cards under your seat to hold, then draw</div>
  <div class="acts">
    <span class="muted small">{selected.length} held</span>
    <button class="btn primary" onclick={draw}>Draw</button>
  </div>
</section>

<style>
  .bar { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .acts { display: flex; gap: 12px; align-items: center; justify-content: center; }
  .small { font-size: 12px; }
</style>
