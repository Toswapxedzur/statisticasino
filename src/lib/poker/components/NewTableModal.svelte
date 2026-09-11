<script>
  // New-table modal. Emits a cfg object matching `table.create`:
  //   poker:     { name?, variant, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin, buyin }
  //   blackjack: { name?, variant:"blackjack", beBanker, smallBlind(=minBet), maxSeats,
  //                minBuyin, maxBuyin, buyin }
  //
  // The game MODE comes in as a prop (chosen by the lobby's game-mode pill); the
  // VARIANT (for poker) is chosen here. A blackjack creator either banks (deep
  // bankroll, up to their whole wallet) or plays while a wealthy bot banks.

  import { POKER_VARIANTS, variantLabel, isShedding as isSheddingFn } from "$lib/poker/games.js";
  import { fade, scale } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import Checkbox from "$lib/components/Checkbox.svelte";

  let { walletChips = 0, mode = "poker", onCreate = () => {}, onCancel = () => {} } = $props();

  const isBanked = $derived(mode !== "poker");           // any GameTable game (vs-house or shedding)
  const isShedding = $derived(isSheddingFn(mode));        // player-vs-player card play, no house
  const isBlackjackMode = $derived(mode === "blackjack"); // only blackjack has rule knobs
  const modeLabel = $derived(isBanked ? variantLabel(mode) : "");

  const PRESETS = [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 5, bb: 10 },
    { sb: 25, bb: 50 }
  ];

  let name = $state("");
  let stake = $state(0); // index into PRESETS, or "custom"
  let customSb = $state(1);
  let customBb = $state(2);
  let variant = $state("holdem");
  let maxSeats = $state(6);
  let beBanker = $state(false);
  let straddle = $state(false);
  let runItTwice = $state(false);
  let buyin = $state(0);
  // Straddle + run-it-twice only make sense in flop games (draw/stud/shedding have
  // no big blind to straddle / no board runout to deal twice).
  const showFlopOpts = $derived(!isBanked && !isSheddingFn(variant) && variant !== "five-card-draw" && variant !== "seven-card-stud");

  // Blackjack house rules
  let bjPays = $state("3:2");
  let bjDecks = $state(6);
  let bjSoft17 = $state(false); // false = dealer stands on soft 17
  let bjSurrender = $state(false);
  let bjPeek = $state(true); // true = American peek; false = European no-peek

  const isCustom = $derived(stake === "custom");

  const smallBlind = $derived(
    isCustom ? Math.max(1, Math.floor(customSb || 0)) : PRESETS[stake].sb
  );
  const bigBlind = $derived(
    isCustom ? Math.max(smallBlind, Math.floor(customBb || 0)) : PRESETS[stake].bb
  );

  // The staking unit: big blind for poker, minimum bet for blackjack.
  const unit = $derived(isBanked ? smallBlind : bigBlind);
  const rangeMin = $derived(20 * unit); // table's player buy-in floor
  const rangeMax = $derived(100 * unit); // table's player buy-in ceiling

  const wallet = $derived(walletChips ?? 0);
  // The creator's own ceiling — a blackjack banker may bank up to their wallet.
  const buyinCeil = $derived(
    isBanked && beBanker ? wallet : Math.min(rangeMax, wallet)
  );
  const canAfford = $derived(wallet >= rangeMin);
  const seatChoices = $derived(isBanked ? [2, 4, 6] : [2, 6, 9]);

  // Clamp the buy-in whenever the bounds shift.
  $effect(() => {
    const lo = rangeMin;
    const hi = Math.max(rangeMin, buyinCeil);
    if (buyin < lo || buyin > hi || buyin === 0) {
      buyin = canAfford ? (isBanked && beBanker ? Math.min(hi, Math.max(lo, rangeMax * 2)) : hi) : lo;
    }
  });

  // Keep the seat count valid when switching modes.
  $effect(() => { if (!seatChoices.includes(maxSeats)) maxSeats = seatChoices[1] ?? seatChoices[0]; });

  function create() {
    if (!canAfford) return;
    const trimmed = name.trim().slice(0, 40);
    if (isBanked) {
      const minBet = smallBlind;
      const minBuyin = 20 * minBet;
      const maxBuyin = 100 * minBet;
      const amount = beBanker
        ? Math.max(minBuyin, Math.min(wallet, Math.round(buyin)))
        : Math.max(minBuyin, Math.min(maxBuyin, wallet, Math.round(buyin)));
      onCreate({
        ...(trimmed ? { name: trimmed } : {}),
        variant: mode,
        beBanker,
        ...(isBlackjackMode
          ? { blackjackPays: bjPays, decks: bjDecks, dealerHitsSoft17: bjSoft17, surrender: bjSurrender, peek: bjPeek }
          : {}),
        smallBlind: minBet,
        maxSeats,
        minBuyin,
        maxBuyin,
        buyin: amount
      });
      return;
    }
    const sb = smallBlind;
    const bb = Math.max(sb, bigBlind);
    const minBuyin = 20 * bb;
    const maxBuyin = 100 * bb;
    const amount = Math.max(minBuyin, Math.min(maxBuyin, wallet, Math.round(buyin)));
    onCreate({
      ...(trimmed ? { name: trimmed } : {}),
      variant,
      smallBlind: sb,
      bigBlind: bb,
      maxSeats,
      minBuyin,
      maxBuyin,
      buyin: amount,
      straddle: showFlopOpts && straddle,
      runItTwice: showFlopOpts && runItTwice
    });
  }

  function onKey(ev) {
    if (ev.key === "Escape") onCancel?.();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal-overlay" role="presentation" onclick={onCancel} transition:fade={{ duration: d(DUR.fast) }}>
  <div
    class="card modal"
    transition:scale={{ start: 0.96, duration: d(DUR.base) }}
    role="dialog"
    aria-modal="true"
    aria-label="New table"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="card-head">
      <h3>{isBanked ? "New " + modeLabel + " table" : "New table"}</h3>
      <button class="x btn btn-secondary btn-xs" aria-label="Close" onclick={onCancel}>✕</button>
    </div>

    <label class="field">
      Table name <span class="muted">(optional)</span>
      <input type="text" placeholder="My table" maxlength="40" bind:value={name} />
    </label>

    {#if !isBanked}
      <div class="field">
        Game
        <div class="chips">
          {#each POKER_VARIANTS as v}
            <button
              type="button"
              class="chip"
              class:on={variant === v.key}
              onclick={() => (variant = v.key)}
            >{v.short}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if showFlopOpts}
      <div class="toggle-row"><Checkbox bind:checked={straddle} label="Straddle table (UTG posts a live 2×BB blind)" /></div>
      <div class="toggle-row"><Checkbox bind:checked={runItTwice} label="Run it twice (deal the board twice on all-ins)" /></div>
    {/if}

    <div class="field">
      {isBanked ? "Minimum bet" : "Stakes"}
      <div class="chips">
        {#each PRESETS as p, i}
          <button type="button" class="chip" class:on={stake === i} onclick={() => (stake = i)}>
            {isBanked ? p.sb : p.sb + "/" + p.bb}
          </button>
        {/each}
        <button type="button" class="chip" class:on={isCustom} onclick={() => (stake = "custom")}>
          Custom
        </button>
      </div>
    </div>

    {#if isCustom}
      <div class="pair">
        <label class="field num">
          {isBanked ? "Minimum bet" : "Small blind"}
          <input type="number" min="1" step="1" bind:value={customSb} />
        </label>
        {#if !isBanked}
          <label class="field num">
            Big blind
            <input type="number" min={smallBlind} step="1" bind:value={customBb} />
          </label>
        {/if}
      </div>
    {/if}

    <div class="field">
      Max seats
      <div class="chips">
        {#each seatChoices as s}
          <button type="button" class="chip" class:on={maxSeats === s} onclick={() => (maxSeats = s)}>
            {s}
          </button>
        {/each}
      </div>
    </div>

    {#if isBanked}
      {#if isShedding}
        <p class="hint muted">Everyone antes the minimum; the first to shed all their cards takes the pot.</p>
      {:else}
        <div class="toggle-row"><Checkbox bind:checked={beBanker} label="I'll be the banker (host the house)" /></div>
        <p class="hint muted">
          {beBanker
            ? "You bank the table with your bankroll and win/lose against every player."
            : "A wealthy bot will bank the table so you can just play."}
        </p>
      {/if}

      {#if isBlackjackMode}
        <div class="field">
          Blackjack pays
          <div class="chips">
            <button type="button" class="chip" class:on={bjPays === "3:2"} onclick={() => (bjPays = "3:2")}>3:2</button>
            <button type="button" class="chip" class:on={bjPays === "6:5"} onclick={() => (bjPays = "6:5")}>6:5</button>
          </div>
        </div>
        <div class="field">
          Decks
          <div class="chips">
            {#each [1, 2, 6, 8] as d}
              <button type="button" class="chip" class:on={bjDecks === d} onclick={() => (bjDecks = d)}>{d}</button>
            {/each}
          </div>
        </div>
        <div class="field">
          Soft 17
          <div class="chips">
            <button type="button" class="chip" class:on={!bjSoft17} onclick={() => (bjSoft17 = false)}>Dealer stands</button>
            <button type="button" class="chip" class:on={bjSoft17} onclick={() => (bjSoft17 = true)}>Dealer hits</button>
          </div>
        </div>
        <div class="toggle-row"><Checkbox bind:checked={bjSurrender} label="Allow late surrender" /></div>
        <div class="toggle-row"><Checkbox bind:checked={bjPeek} label="Dealer peeks for blackjack (American)" /></div>
      {/if}
    {/if}

    <div class="field">
      {isBanked && beBanker ? "Bankroll" : "Buy-in"}
      {#if canAfford}
        <div class="amount">{buyin.toLocaleString()}</div>
        <input
          class="rng"
          type="range"
          style="--fill:{((buyin - rangeMin) / Math.max(1, Math.max(rangeMin, buyinCeil) - rangeMin)) * 100}%"
          min={rangeMin}
          max={Math.max(rangeMin, buyinCeil)}
          step="1"
          bind:value={buyin}
        />
        <div class="bounds">
          <span class="muted">min {rangeMin.toLocaleString()}</span>
          <span class="muted">max {buyinCeil.toLocaleString()}</span>
        </div>
        <input
          class="exact"
          type="text"
          inputmode="numeric"
          aria-label="Exact buy-in"
          value={buyin}
          oninput={(e) => {
            const n = parseInt(e.currentTarget.value.replace(/[^0-9]/g, ""), 10);
            buyin = Number.isFinite(n) ? n : rangeMin;
          }}
        />
      {:else}
        <p class="short">
          You need at least <strong>{rangeMin.toLocaleString()}</strong> chips for
          these stakes, but your wallet only has
          <strong>{wallet.toLocaleString()}</strong>.
          <a href="/account">Grab your daily bonus.</a>
        </p>
      {/if}
    </div>

    <div class="wallet muted">Wallet balance: {wallet.toLocaleString()}</div>

    <div class="actions">
      <button class="btn btn-secondary" onclick={onCancel}>Cancel</button>
      <button class="btn" onclick={create} disabled={!canAfford}>
        {isBanked ? "Create " + modeLabel + " table" : "Create table"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--bg) 72%, transparent); padding: 16px;
  }
  .modal {
    width: 100%; max-width: 420px; margin: 0;
    max-height: calc(100vh - 32px); overflow-y: auto;
    box-shadow: var(--shadow-panel);
  }

  .field { display: block; font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
  .field input[type="text"], .field input[type="number"] { width: 100%; margin-top: 6px; }

  .pair { display: flex; gap: 10px; }
  .pair .num { flex: 1; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .chip {
    appearance: none; background: var(--well);
    color: var(--text); border-radius: var(--r-btn); padding: 7px 12px; font-size: 13px;
    cursor: pointer; transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .chip:hover { background: var(--surface-2); transform: translateY(-1px); }
  .chip.on { background: var(--accent); color: var(--on-accent); box-shadow: 0 0 0 2px var(--accent-soft); font-weight: 600; }

  .toggle {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text); margin-bottom: 6px; cursor: pointer;
  }
  .toggle input { width: 16px; height: 16px; accent-color: var(--accent); }
  .toggle-row { margin: 8px 0; }
  .hint { font-size: 12px; margin: 0 0 14px; line-height: 1.4; }

  .amount { text-align: center; font-size: 30px; font-weight: 700; color: var(--accent); letter-spacing: 0.5px; margin: 8px 0 4px; }
  .bounds { display: flex; justify-content: space-between; font-size: 11.5px; margin: 4px 0 10px; }
  .exact { width: 100%; }

  .short { font-size: 13px; line-height: 1.5; margin: 8px 0 0; color: var(--text); }
  .short a { color: var(--accent-ink); }

  .wallet { font-size: 12px; margin-bottom: 14px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .actions .btn { text-decoration: none; }
</style>
