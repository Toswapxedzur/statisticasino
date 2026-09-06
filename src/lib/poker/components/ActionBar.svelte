<script>
  // ActionBar — the acting player's control strip. Rendered only when it
  // is the signed-in user's turn (parent gates on `poker.turns[id]`).
  //
  // Props:
  //   turn     — the TABLE_TURN menu (DESIGN.md §2): { seat, deadline,
  //              callAmount, currentBet, minRaise, potTotal, actions[] }.
  //              `actions` is the subset of legal moves, each one of:
  //                {type:'fold'}
  //                {type:'check'} | {type:'call', amount}
  //                {type:'bet', min, max} | {type:'raise', min, max}
  //                {type:'allin', amount}
  //   config   — table config { smallBlind, bigBlind, ... } (slider step).
  //   potTotal — current total pot (chips), for pot-fraction quick bets.
  //   myStack  — my chips at the table (informational).
  //   onAct    — callback: onAct({ type, amount? }). `amount` is the TOTAL
  //              street target commitment for bet/raise (engine semantics).

  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  let { turn, config, potTotal, myStack, onAct } = $props();

  // ---- legal-action lookups -------------------------------------------

  const actions = $derived(turn?.actions ?? []);
  const foldAction  = $derived(actions.find((a) => a.type === "fold"));
  const checkAction = $derived(actions.find((a) => a.type === "check"));
  const callAction  = $derived(actions.find((a) => a.type === "call"));
  // 'bet' (no live wager) and 'raise' (over an existing wager) share one
  // control — both carry {min,max} as TOTAL street targets.
  const raiseAction = $derived(actions.find((a) => a.type === "bet" || a.type === "raise"));
  const allinAction = $derived(actions.find((a) => a.type === "allin"));

  const callAmount = $derived(turn?.callAmount ?? 0);
  const currentBet = $derived(turn?.currentBet ?? 0);
  // Prefer the explicit prop; fall back to the value echoed in the menu.
  const pot = $derived((potTotal ?? turn?.potTotal) ?? 0);
  const step = $derived(config?.bigBlind && config.bigBlind > 0 ? config.bigBlind : 1);

  // ---- raise target (TOTAL street commitment) -------------------------

  let raiseTarget = $state(0);

  // Reset to the minimum legal raise whenever a fresh turn/menu arrives.
  // `turn` is replaced object-by-object per TABLE_TURN, so keying on the
  // raise bounds re-runs this each new decision.
  $effect(() => {
    if (raiseAction) raiseTarget = raiseAction.min;
  });

  function clampSnap(v) {
    if (!raiseAction) return 0;
    let x = Math.round(Number(v));
    if (!Number.isFinite(x)) x = raiseAction.min;
    return Math.max(raiseAction.min, Math.min(raiseAction.max, x));
  }

  // Pot-fraction raise TARGET (total street commitment):
  //   target = call-equivalent total (currentBet) + fraction × (pot after
  //   my call = potTotal + callAmount), then clamped to [min,max] which
  //   already enforces the min-raise floor.
  function potFractionTarget(fraction) {
    const potAfterCall = pot + callAmount;
    return clampSnap(currentBet + fraction * potAfterCall);
  }

  function setQuick(fraction) {
    raiseTarget = potFractionTarget(fraction);
  }
  function setMax() {
    if (raiseAction) raiseTarget = raiseAction.max;
  }

  function onNumberChange() {
    raiseTarget = clampSnap(raiseTarget);
  }

  const raiseVerb = $derived(raiseAction?.type === "bet" ? "Bet" : "Raise to");
  const atMax = $derived(raiseAction ? raiseTarget >= raiseAction.max : false);
  // Filled fraction of the custom range track (0..100), for the accent paint.
  const fillPct = $derived(
    raiseAction ? ((raiseTarget - raiseAction.min) / Math.max(1, raiseAction.max - raiseAction.min)) * 100 : 0
  );

  // ---- countdown to deadline ------------------------------------------

  const ACTION_WINDOW_MS = 25_000; // mirrors ACTION_TIMEOUT_MS for the bar

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { now = Date.now(); }, 200);
    return () => clearInterval(id);
  });

  const remainingMs = $derived(Math.max(0, (turn?.deadline ?? 0) - now));
  const remainingSec = $derived(remainingMs / 1000);
  const urgent = $derived(remainingMs > 0 && remainingMs <= 5_000);
  const barPct = $derived(
    Math.max(0, Math.min(100, (remainingMs / ACTION_WINDOW_MS) * 100))
  );

  // ---- emit -----------------------------------------------------------

  function fold()  { onAct?.({ type: "fold" }); }
  function check() { onAct?.({ type: "check" }); }
  function call()  { onAct?.({ type: "call" }); }
  function allin() { onAct?.({ type: "allin" }); }
  function raise() {
    if (!raiseAction) return;
    onAct?.({ type: raiseAction.type, amount: clampSnap(raiseTarget) });
  }
</script>

{#if turn && actions.length}
  <div class="actionbar card" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
    <!-- subtle countdown -->
    <div class="timer" class:urgent aria-live="off">
      <div class="timer-bar"><span style="width:{barPct}%"></span></div>
      <span class="timer-text">{remainingSec.toFixed(remainingSec < 10 ? 1 : 0)}s</span>
    </div>

    <div class="controls">
      <div class="primary">
        {#if foldAction}
          <button type="button" class="btn btn-danger" onclick={fold}>Fold</button>
        {/if}

        {#if checkAction}
          <button type="button" class="btn btn-secondary" onclick={check}>Check</button>
        {:else if callAction}
          <button type="button" class="btn" onclick={call}>
            Call <span class="amt">{callAction.amount}</span>
          </button>
        {/if}

        {#if raiseAction}
          <button type="button" class="btn" onclick={raise}>
            {raiseVerb} <span class="amt">{raiseTarget}</span>
          </button>
        {/if}

        {#if allinAction}
          <button type="button" class="btn btn-secondary" onclick={allin}>
            All-in <span class="amt">{allinAction.amount}</span>
          </button>
        {/if}
      </div>

      {#if raiseAction}
        <div class="raise">
          <div class="quick">
            <button type="button" class="chip" onclick={() => setQuick(0.5)}>½ pot</button>
            <button type="button" class="chip" onclick={() => setQuick(0.75)}>¾ pot</button>
            <button type="button" class="chip" onclick={() => setQuick(1)}>Pot</button>
            <button type="button" class="chip" class:active={atMax} onclick={setMax}>All-in</button>
          </div>

          <div class="slider-row">
            <input
              class="rng"
              type="range"
              style="--fill:{fillPct}%"
              min={raiseAction.min}
              max={raiseAction.max}
              step={step}
              bind:value={raiseTarget}
              aria-label="Raise amount"
            />
            <input
              class="num"
              type="number"
              min={raiseAction.min}
              max={raiseAction.max}
              step={step}
              bind:value={raiseTarget}
              onchange={onNumberChange}
              onblur={onNumberChange}
              aria-label="Raise amount (exact)"
            />
          </div>

          <div class="raise-meta muted">
            <span>min {raiseAction.min}</span>
            <span>max {raiseAction.max}</span>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .actionbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px;
  }

  /* ---- countdown ---- */
  .timer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .timer-bar {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: var(--well);
    overflow: hidden;
  }
  .timer-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 200ms linear;
  }
  .timer-text {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    min-width: 34px;
    text-align: right;
  }
  .timer.urgent .timer-bar span { background: var(--danger); }
  .timer.urgent .timer-text { color: var(--danger); }

  /* ---- controls ---- */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .primary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary .btn { flex: 1 1 auto; min-width: 84px; }
  .amt { font-variant-numeric: tabular-nums; opacity: 0.85; }

  /* ---- raise control ---- */
  .raise {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    appearance: none;
    background: var(--well);
    color: var(--text);
    border: 0;
    border-radius: var(--r-pill);
    padding: 5px 13px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .chip:hover { background: var(--accent-soft); color: var(--accent-ink); }
  .chip.active {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .num {
    width: 92px;
    background: var(--well);
    border: 0;
    color: var(--text);
    border-radius: var(--r-btn);
    padding: 7px 9px;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
    transition: box-shadow var(--dur) var(--ease);
  }
  .num:focus {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .raise-meta {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
