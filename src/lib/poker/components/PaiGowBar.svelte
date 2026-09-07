<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Pai Gow controls. Tap two cards under your seat badge for the FRONT hand;
  // `selected` holds those card strings. Emits { type:"set", front } or { type:"set", auto:true }.
  let { selected = [], onAct = () => {} } = $props();
</script>

<section class="bar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">Tap 2 cards under your seat for your <strong>front</strong> hand — the other five are your back hand</div>
  <div class="acts">
    <button class="btn btn-secondary" onclick={() => onAct({ type: "set", auto: true })}>Auto (house way)</button>
    <button class="btn primary" onclick={() => selected.length === 2 && onAct({ type: "set", front: [...selected] })} disabled={selected.length !== 2}>Set hand ({selected.length}/2)</button>
  </div>
</section>

<style>
  .bar { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .acts { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
</style>
