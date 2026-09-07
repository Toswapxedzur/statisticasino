<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Five-Card Draw controls. The cards themselves live under your seat badge and
  // are toggled there; `selected` is the set of discard indices the page tracks.
  //   { type: "draw", discards: number[] }
  let { selected = [], onAct = () => {} } = $props();
</script>

<section class="bar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">Tap cards under your seat to discard, then Draw — or stand pat</div>
  <div class="acts">
    <button class="btn btn-secondary" onclick={() => onAct({ type: "draw", discards: [] })}>Stand pat</button>
    <button class="btn primary" onclick={() => onAct({ type: "draw", discards: [...selected] })}>Draw {selected.length}</button>
  </div>
</section>

<style>
  .bar { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .acts { display: flex; gap: 12px; justify-content: center; }
</style>
