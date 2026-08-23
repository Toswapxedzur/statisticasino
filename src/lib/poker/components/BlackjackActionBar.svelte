<script>
  // Blackjack action bar. The server's TABLE_TURN carries { phase, actions }:
  //   betting → [{type:"bet", min, max}]
  //   acting  → [{type:"hit"}, {type:"stand"}, {type:"double"}?]
  // Emits the chosen action via onAct.

  let { turn, onAct = () => {} } = $props();

  const phase = $derived(turn?.phase);
  const actions = $derived(turn?.actions || []);
  const betAction = $derived(actions.find((a) => a.type === "bet") || null);

  let bet = $state(0);
  $effect(() => {
    if (betAction) {
      const lo = betAction.min;
      const hi = betAction.max;
      if (bet < lo || bet > hi || bet === 0) bet = lo;
    }
  });

  const has = (type) => actions.some((a) => a.type === type);
</script>

<section class="actionbar">
  {#if phase === "betting" && betAction}
    <div class="bet-row">
      <span class="lbl">Your bet</span>
      <input
        class="slider"
        type="range"
        min={betAction.min}
        max={betAction.max}
        step="1"
        bind:value={bet}
      />
      <span class="amt">{bet.toLocaleString()}</span>
      <button class="btn primary" onclick={() => onAct({ type: "bet", amount: bet })}>Bet</button>
    </div>
    <div class="quick">
      {#each [betAction.min, betAction.min * 2, betAction.min * 5, betAction.max] as q}
        {#if q >= betAction.min && q <= betAction.max}
          <button class="btn btn-sm ghost" onclick={() => (bet = q)}>{q.toLocaleString()}</button>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="acts">
      {#if has("hit")}<button class="btn primary" onclick={() => onAct({ type: "hit" })}>Hit</button>{/if}
      {#if has("stand")}<button class="btn" onclick={() => onAct({ type: "stand" })}>Stand</button>{/if}
      {#if has("double")}<button class="btn ghost" onclick={() => onAct({ type: "double" })}>Double</button>{/if}
    </div>
  {/if}
</section>

<style>
  .actionbar {
    max-width: 620px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface, #16161c); border: 1px solid var(--border, #333);
    border-radius: 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .bet-row { display: flex; align-items: center; gap: 12px; }
  .lbl { font-size: 13px; color: var(--muted); flex: 0 0 auto; }
  .slider { flex: 1; accent-color: var(--accent, #6cf); cursor: pointer; }
  .amt { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 64px; text-align: right; }
  .quick { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .acts { display: flex; gap: 10px; justify-content: center; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
  .btn.ghost { background: transparent; }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
</style>
