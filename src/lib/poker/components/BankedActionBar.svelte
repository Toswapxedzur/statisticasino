<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  // Generic action bar for any banked game (blackjack, casino-holdem, …). The
  // server's TABLE_TURN carries { phase, actions }. If there's a wager action
  // (bet / ante) it shows an amount slider; otherwise a button per action type
  // (hit / stand / double / surrender / call / fold …). Reads only the menu, so a
  // new game needs no new component.

  let { turn, onAct = () => {} } = $props();

  const actions = $derived(turn?.actions || []);
  const wager = $derived(actions.find((a) => a.type === "bet" || a.type === "ante") || null);
  const decisions = $derived(actions.filter((a) => a.type !== "bet" && a.type !== "ante"));

  let amt = $state(0);
  $effect(() => {
    if (wager) {
      const lo = wager.min, hi = wager.max;
      if (amt < lo || amt > hi || amt === 0) amt = lo;
    }
  });

  const LABELS = {
    hit: "Hit", stand: "Stand", double: "Double", surrender: "Surrender",
    call: "Call", play: "Play", fold: "Fold",
    check: "Check", raise: "Raise", ride: "Let it ride", pull: "Pull back",
    play4x: "Play 4×", play3x: "Play 3×", play2x: "Play 2×", play1x: "Play 1×"
  };
  const label = (a) => (LABELS[a.type] || a.type) + (a.amount ? " " + a.amount.toLocaleString() : "");
  const primary = (t) => t === "hit" || t === "call" || t === "raise" || t === "ride" || t.startsWith("play");
  const ghost = (t) => t === "fold" || t === "pull";
</script>

<section class="actionbar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  {#if wager}
    <div class="bet-row">
      <span class="lbl">{wager.type === "ante" ? "Ante" : "Your bet"}</span>
      <input
        class="rng wager-range"
        type="range"
        style="--fill:{((amt - wager.min) / Math.max(1, wager.max - wager.min)) * 100}%"
        min={wager.min}
        max={wager.max}
        step="1"
        bind:value={amt}
      />
      <span class="amt">{amt.toLocaleString()}</span>
      <button class="btn primary" onclick={() => onAct({ type: wager.type, amount: amt })}>
        {wager.type === "ante" ? "Ante" : "Bet"}
      </button>
    </div>
    <div class="quick">
      {#each [wager.min, wager.min * 2, wager.min * 5, wager.max] as q}
        {#if q >= wager.min && q <= wager.max}
          <button class="btn btn-secondary btn-sm ghost" onclick={() => (amt = q)}>{q.toLocaleString()}</button>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="acts">
      {#each decisions as a}
        <button
          class="btn {primary(a.type) ? 'primary' : ghost(a.type) ? 'ghost' : ''}"
          class:btn-secondary={ghost(a.type)}
          onclick={() => onAct({ type: a.type })}
        >
          {label(a)}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .actionbar {
    max-width: 620px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 10px;
  }
  .bet-row { display: flex; align-items: center; gap: 12px; }
  .lbl { font-size: 13px; color: var(--muted); flex: 0 0 auto; }
  .wager-range { flex: 1; min-width: 0; }
  .amt { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 64px; text-align: right; }
  .quick { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .acts { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
</style>
