<script>
  // New-table modal. Emits a cfg object matching `table.create`:
  //   poker:     { name?, variant, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin, buyin }
  //   blackjack: { name?, variant:"blackjack", beBanker, smallBlind(=minBet), maxSeats,
  //                minBuyin, maxBuyin, buyin }
  //
  // The game MODE comes in as a prop (chosen by the lobby's game-mode pill); the
  // VARIANT (for poker) is chosen here. A blackjack creator either banks (deep
  // bankroll, up to their whole wallet) or plays while a wealthy bot banks.

  import { POKER_VARIANTS } from "$lib/poker/games.js";

  let { walletChips = 0, mode = "poker", onCreate = () => {}, onCancel = () => {} } = $props();

  const isBlackjack = $derived(mode === "blackjack");

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
  let buyin = $state(0);

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
  const unit = $derived(isBlackjack ? smallBlind : bigBlind);
  const rangeMin = $derived(20 * unit); // table's player buy-in floor
  const rangeMax = $derived(100 * unit); // table's player buy-in ceiling

  const wallet = $derived(walletChips ?? 0);
  // The creator's own ceiling — a blackjack banker may bank up to their wallet.
  const buyinCeil = $derived(
    isBlackjack && beBanker ? wallet : Math.min(rangeMax, wallet)
  );
  const canAfford = $derived(wallet >= rangeMin);
  const seatChoices = $derived(isBlackjack ? [2, 4, 6] : [2, 6, 9]);

  // Clamp the buy-in whenever the bounds shift.
  $effect(() => {
    const lo = rangeMin;
    const hi = Math.max(rangeMin, buyinCeil);
    if (buyin < lo || buyin > hi || buyin === 0) {
      buyin = canAfford ? (isBlackjack && beBanker ? Math.min(hi, Math.max(lo, rangeMax * 2)) : hi) : lo;
    }
  });

  // Keep the seat count valid when switching modes.
  $effect(() => { if (!seatChoices.includes(maxSeats)) maxSeats = seatChoices[1] ?? seatChoices[0]; });

  function create() {
    if (!canAfford) return;
    const trimmed = name.trim().slice(0, 40);
    if (isBlackjack) {
      const minBet = smallBlind;
      const minBuyin = 20 * minBet;
      const maxBuyin = 100 * minBet;
      const amount = beBanker
        ? Math.max(minBuyin, Math.min(wallet, Math.round(buyin)))
        : Math.max(minBuyin, Math.min(maxBuyin, wallet, Math.round(buyin)));
      onCreate({
        ...(trimmed ? { name: trimmed } : {}),
        variant: "blackjack",
        beBanker,
        blackjackPays: bjPays,
        decks: bjDecks,
        dealerHitsSoft17: bjSoft17,
        surrender: bjSurrender,
        peek: bjPeek,
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
      buyin: amount
    });
  }

  function onKey(ev) {
    if (ev.key === "Escape") onCancel?.();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal-overlay" role="presentation" onclick={onCancel}>
  <div
    class="card modal"
    role="dialog"
    aria-modal="true"
    aria-label="New table"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="card-head">
      <h3>{isBlackjack ? "New blackjack table" : "New table"}</h3>
      <button class="x" aria-label="Close" onclick={onCancel}>✕</button>
    </div>

    <label class="field">
      Table name <span class="muted">(optional)</span>
      <input type="text" placeholder="My table" maxlength="40" bind:value={name} />
    </label>

    {#if !isBlackjack}
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

    <div class="field">
      {isBlackjack ? "Minimum bet" : "Stakes"}
      <div class="chips">
        {#each PRESETS as p, i}
          <button type="button" class="chip" class:on={stake === i} onclick={() => (stake = i)}>
            {isBlackjack ? p.sb : p.sb + "/" + p.bb}
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
          {isBlackjack ? "Minimum bet" : "Small blind"}
          <input type="number" min="1" step="1" bind:value={customSb} />
        </label>
        {#if !isBlackjack}
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

    {#if isBlackjack}
      <label class="toggle">
        <input type="checkbox" bind:checked={beBanker} />
        <span>I'll be the banker (host the house)</span>
      </label>
      <p class="hint muted">
        {beBanker
          ? "You bank the table with your bankroll and win/lose against every player."
          : "A wealthy bot will bank the table so you can just play."}
      </p>

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
      <label class="toggle"><input type="checkbox" bind:checked={bjSurrender} /><span>Allow late surrender</span></label>
      <label class="toggle"><input type="checkbox" bind:checked={bjPeek} /><span>Dealer peeks for blackjack (American)</span></label>
    {/if}

    <div class="field">
      {isBlackjack && beBanker ? "Bankroll" : "Buy-in"}
      {#if canAfford}
        <div class="amount">{buyin.toLocaleString()}</div>
        <input
          class="slider"
          type="range"
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
        {isBlackjack ? "Create blackjack table" : "Create table"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6); padding: 16px;
  }
  .modal {
    width: 100%; max-width: 420px; margin: 0;
    max-height: calc(100vh - 32px); overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .x {
    appearance: none; background: transparent; border: 0; color: var(--muted);
    font-size: 15px; cursor: pointer; padding: 2px 6px; line-height: 1;
  }
  .x:hover { color: var(--text); }

  .field { display: block; font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
  .field input[type="text"], .field input[type="number"] { width: 100%; margin-top: 6px; }

  .pair { display: flex; gap: 10px; }
  .pair .num { flex: 1; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .chip {
    appearance: none; background: transparent; border: 1px solid var(--border);
    color: var(--text); border-radius: 8px; padding: 7px 12px; font-size: 13px;
    cursor: pointer; transition: border-color 0.12s, background 0.12s;
  }
  .chip:hover { border-color: var(--accent); }
  .chip.on { border-color: var(--accent); background: var(--accent); color: #0b0b0b; font-weight: 600; }

  .toggle {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text); margin-bottom: 6px; cursor: pointer;
  }
  .toggle input { width: 16px; height: 16px; accent-color: var(--accent); }
  .hint { font-size: 12px; margin: 0 0 14px; line-height: 1.4; }

  .amount { text-align: center; font-size: 30px; font-weight: 700; color: var(--accent); letter-spacing: 0.5px; margin: 8px 0 4px; }
  .slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
  .bounds { display: flex; justify-content: space-between; font-size: 11.5px; margin: 4px 0 10px; }
  .exact { width: 100%; }

  .short { font-size: 13px; line-height: 1.5; margin: 8px 0 0; color: var(--text); }
  .short a { color: var(--accent); }

  .wallet { font-size: 12px; margin-bottom: 14px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .actions .btn { text-decoration: none; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
