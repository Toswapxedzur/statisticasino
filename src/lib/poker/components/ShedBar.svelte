<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Big Two controls. The hand is under your seat badge: taps select cards, Play sends `selected`
  // as one combination; Pass when you can't (or won't) beat the pile.
  let { turn = null, selected = [], onAct = () => {} } = $props();

  const myTurn = $derived(!!turn && !!turn.shedGame);
  const canPass = $derived(!!turn?.canPass);
  const mustInclude = $derived(turn?.mustInclude || null);
  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
</script>

<section class="bar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">
    {#if !myTurn}Waiting for your turn…
    {:else}Select cards under your seat, then Play{#if mustInclude} · must include {mustInclude[0]}<span class:red={isRed(mustInclude[1])}>{SUIT[mustInclude[1]]}</span>{/if}{/if}
  </div>
  {#if myTurn}
    <div class="acts">
      {#if canPass}<button class="btn btn-secondary" onclick={() => onAct({ type: "pass" })}>Pass</button>{/if}
      <button class="btn primary" onclick={() => selected.length && onAct({ type: "play", cards: [...selected] })} disabled={!selected.length}>Play {selected.length || ""}</button>
    </div>
  {/if}
</section>

<style>
  .bar { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .red { color: var(--card-red); }
  .acts { display: flex; gap: 12px; justify-content: center; }
</style>
