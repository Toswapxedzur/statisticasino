<script>
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

<section class="kenobar">
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
    <button class="btn ghost" onclick={() => (picked = [])} disabled={!picked.length}>Clear</button>
    <button class="btn" onclick={() => onAct({ type: "pick", spots: [], amount: 0 })}>Skip</button>
    <button class="btn primary" onclick={play} disabled={!picked.length}>Play {bet.toLocaleString()}</button>
  </div>
</section>

<style>
  .kenobar {
    max-width: 560px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface, #16161c); border: 1px solid var(--border, #333);
    border-radius: 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 13px; }
  .lbl { color: var(--muted, #9aa); }
  .chips { display: flex; align-items: center; gap: 6px; }
  .chip {
    appearance: none; cursor: pointer; border: 1px solid var(--border); background: transparent;
    color: var(--text); border-radius: 999px; padding: 3px 10px; font-size: 12.5px; font-weight: 600;
  }
  .chip.on { border-color: var(--accent, #6cf); background: color-mix(in srgb, var(--accent, #6cf) 18%, transparent); color: var(--accent, #6cf); }
  .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
  .cell {
    appearance: none; cursor: pointer; border: 1px solid var(--border, #333); background: #10141b; color: var(--text, #eee);
    border-radius: 6px; padding: 6px 0; font-size: 12.5px; font-variant-numeric: tabular-nums; text-align: center;
  }
  .cell:hover { border-color: var(--accent, #6cf); }
  .cell.on { border-color: var(--accent, #6cf); background: color-mix(in srgb, var(--accent, #6cf) 25%, #10141b); color: #fff; font-weight: 700; }
  .acts { display: flex; gap: 10px; justify-content: flex-end; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
  .btn.ghost { background: transparent; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
