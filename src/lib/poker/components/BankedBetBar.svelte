<script>
  // Bet-selection UI for baccarat/roulette/sic-bo. The TABLE_TURN carries
  // betOptions + minBet + maxTotal. The player picks a chip denomination, clicks
  // outcomes to stake chips on them, then places all bets at once as one action:
  //   { type: "bet", bets: [{ option, amount }] }
  // Reads only the menu, so a new bet-selection game needs no new component.

  let { turn, onAct = () => {} } = $props();

  const options = $derived(turn?.betOptions || []);
  const minBet = $derived(turn?.minBet || 1);
  const maxTotal = $derived(turn?.maxTotal || 0);
  const chips = $derived([minBet, minBet * 5, minBet * 25].filter((c, i, a) => a.indexOf(c) === i && c <= Math.max(minBet, maxTotal)));

  let chip = $state(0);
  $effect(() => { if (!chips.includes(chip)) chip = chips[0] || minBet; });
  let stakes = $state({}); // option key -> amount
  const total = $derived(Object.values(stakes).reduce((s, a) => s + a, 0));

  function add(key) {
    if (total + chip > maxTotal) return;
    stakes = { ...stakes, [key]: (stakes[key] || 0) + chip };
  }
  function clear() { stakes = {}; }
  function place() {
    const bets = Object.entries(stakes).filter(([, a]) => a >= minBet).map(([option, amount]) => ({ option, amount }));
    onAct({ type: "bet", bets });
    stakes = {};
  }
</script>

<section class="betbar">
  <div class="chiprow">
    <span class="lbl">Chip</span>
    {#each chips as c}<button class="chip" class:on={chip === c} onclick={() => (chip = c)}>{c.toLocaleString()}</button>{/each}
    <span class="total">staked {total.toLocaleString()} / {maxTotal.toLocaleString()}</span>
  </div>
  <div class="options">
    {#each options as o}
      <button class="opt" class:staked={stakes[o.key]} onclick={() => add(o.key)}>
        <span class="olabel">{o.label}</span>
        <span class="opay">{o.payout}</span>
        {#if stakes[o.key]}<span class="ostake">{stakes[o.key].toLocaleString()}</span>{/if}
      </button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn btn-secondary ghost" onclick={clear} disabled={total === 0}>Clear</button>
    <button class="btn btn-secondary" onclick={() => onAct({ type: "bet", bets: [] })}>Skip</button>
    <button class="btn primary" onclick={place} disabled={total < minBet}>Place bets</button>
  </div>
</section>

<style>
  .betbar {
    max-width: 640px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 12px;
  }
  .chiprow { display: flex; align-items: center; gap: 8px; }
  .lbl { font-size: 13px; color: var(--muted); }
  .total { margin-left: auto; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .chip {
    appearance: none; cursor: pointer; background: var(--well);
    color: var(--text); border-radius: var(--r-pill); padding: 5px 12px; font-size: 13px; font-weight: 600;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .chip:hover { background: var(--surface-2); transform: translateY(-1px); }
  .chip.on { background: var(--accent-soft); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--accent); }
  .options { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .opt {
    appearance: none; cursor: pointer; background: var(--well); color: var(--text);
    border-radius: var(--r-btn); padding: 10px; display: flex; flex-direction: column; gap: 2px; align-items: center; position: relative;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .opt:hover { background: var(--surface-2); transform: translateY(-1px); }
  .opt.staked { background: var(--accent-soft); box-shadow: 0 0 0 2px var(--accent); }
  .olabel { font-weight: 700; font-size: 14px; }
  .opay { font-size: 11.5px; color: var(--muted); }
  .ostake {
    position: absolute; top: -8px; right: -8px; background: var(--gold-bg); color: var(--gold-ink);
    border-radius: var(--r-pill); padding: 2px 8px; font-size: 12px; font-weight: 700;
  }
  .acts { display: flex; gap: 10px; justify-content: flex-end; }
</style>
