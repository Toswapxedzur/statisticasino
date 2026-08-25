<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  // Keno ticket UI: mark up to `maxSpots` numbers on the 1–80 grid, pick a bet,
  // and Play — emits { type: "pick", spots: number[], amount }.

  let { turn, onAct = () => {} } = $props();

  const minBet = $derived(turn?.minBet || 1);
  const maxTotal = $derived(turn?.maxTotal || 0);
  const maxSpots = $derived(turn?.maxSpots || 10);
  const chips = $derived([minBet, minBet * 5, minBet * 25].filter((c, i, a) => a.indexOf(c) === i && c <= Math.max(minBet, maxTotal)));

  let bet = $state(0);
  $effect(() => { if (!chips.includes(bet)) bet = chips[0] || minBet; });
  let picked = $state([]);

  function toggle(n) {
    if (picked.includes(n)) picked = picked.filter((x) => x !== n);
    else if (picked.length < maxSpots) picked = [...picked, n];
  }
  function play() { if (picked.length) { onAct({ type: "pick", spots: [...picked], amount: bet }); picked = []; } }
  const nums = Array.from({ length: 80 }, (_, i) => i + 1);
</script>

<section class="kenobar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="top">
    <span class="lbl">Pick up to {maxSpots} · <strong>{picked.length}</strong> chosen</span>
    <span class="chips">Bet
      {#each chips as c}<button class="chip" class:on={bet === c} onclick={() => (bet = c)}>{c.toLocaleString()}</button>{/each}
    </span>
  </div>
  <div class="grid">
    {#each nums as n}
      <button class="cell" class:on={picked.includes(n)} onclick={() => toggle(n)}>{n}</button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn btn-secondary ghost" onclick={() => (picked = [])} disabled={!picked.length}>Clear</button>
    <button class="btn btn-secondary" onclick={() => onAct({ type: "pick", spots: [], amount: 0 })}>Skip</button>
    <button class="btn primary" onclick={play} disabled={!picked.length}>Play {bet.toLocaleString()}</button>
  </div>
</section>

<style>
  .kenobar {
    max-width: 560px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 10px;
  }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 13px; }
  .lbl { color: var(--muted); }
  .chips { display: flex; align-items: center; gap: 6px; }
  .chip {
    appearance: none; cursor: pointer; background: var(--well);
    color: var(--text); border-radius: var(--r-pill); padding: 3px 10px; font-size: 12.5px; font-weight: 600;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .chip:hover { background: var(--surface-2); transform: translateY(-1px); }
  .chip.on { background: var(--accent-soft); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
  .cell {
    appearance: none; cursor: pointer; background: var(--well); color: var(--text);
    border-radius: 6px; padding: 6px 0; font-size: 12.5px; font-variant-numeric: tabular-nums; text-align: center;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .cell:hover { background: var(--surface-2); transform: translateY(-1px); }
  .cell.on { background: var(--accent-soft); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--accent); font-weight: 700; }
  .acts { display: flex; gap: 10px; justify-content: flex-end; }
</style>
