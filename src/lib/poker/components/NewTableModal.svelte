<script>
  // New-table modal (DESIGN-LOBBY.md §UI). Configure a table, then emit a
  // cfg object matching `table.create` / poker.createTable():
  //   { name?, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin, buyin }
  //
  //   onCreate(cfg) -> create the table (and auto-seat the creator server-side)
  //   onCancel()    -> dismiss without creating
  //
  // Stakes come from presets (or a Custom blind pair). Each stake implies a
  // default buy-in range (min = 20*bb, max = 100*bb). The buy-in slider is
  // bounded by [rangeMin, min(rangeMax, walletChips)]; if the wallet can't
  // cover the range minimum, Create is disabled and we point at /account.

  let { walletChips = 0, onCreate = () => {}, onCancel = () => {} } = $props();

  const PRESETS = [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 5, bb: 10 },
    { sb: 25, bb: 50 },
  ];

  let name = $state("");
  // Index into PRESETS, or "custom".
  let stake = $state(0);
  let customSb = $state(1);
  let customBb = $state(2);
  let maxSeats = $state(6);
  let buyin = $state(0);

  const isCustom = $derived(stake === "custom");

  // Effective blinds from the chosen stake.
  const smallBlind = $derived(
    isCustom ? Math.max(1, Math.floor(customSb || 0)) : PRESETS[stake].sb,
  );
  const bigBlind = $derived(
    isCustom
      ? Math.max(smallBlind, Math.floor(customBb || 0))
      : PRESETS[stake].bb,
  );

  // Buy-in range implied by the big blind.
  const rangeMin = $derived(20 * bigBlind);
  const rangeMax = $derived(100 * bigBlind);

  const wallet = $derived(walletChips ?? 0);
  // Upper bound the player can actually afford.
  const buyinMax = $derived(Math.min(rangeMax, wallet));
  const canAfford = $derived(wallet >= rangeMin);

  // Clamp the buy-in whenever the bounds shift (stake change, wallet update).
  $effect(() => {
    const lo = rangeMin;
    const hi = Math.max(rangeMin, buyinMax);
    if (buyin < lo || buyin > hi || buyin === 0) {
      buyin = canAfford ? hi : lo;
    }
  });

  function create() {
    if (!canAfford) return;
    const sb = smallBlind;
    const bb = Math.max(sb, bigBlind);
    const minBuyin = 20 * bb;
    const maxBuyin = 100 * bb;
    const amount = Math.max(minBuyin, Math.min(maxBuyin, wallet, Math.round(buyin)));
    const trimmed = name.trim().slice(0, 40);
    onCreate({
      ...(trimmed ? { name: trimmed } : {}),
      smallBlind: sb,
      bigBlind: bb,
      maxSeats,
      minBuyin,
      maxBuyin,
      buyin: amount,
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
      <h3>New table</h3>
      <button class="x" aria-label="Close" onclick={onCancel}>✕</button>
    </div>

    <label class="field">
      Table name <span class="muted">(optional)</span>
      <input
        type="text"
        placeholder="My table"
        maxlength="40"
        bind:value={name}
      />
    </label>

    <div class="field">
      Stakes
      <div class="chips">
        {#each PRESETS as p, i}
          <button
            type="button"
            class="chip"
            class:on={stake === i}
            onclick={() => (stake = i)}
          >
            {p.sb}/{p.bb}
          </button>
        {/each}
        <button
          type="button"
          class="chip"
          class:on={isCustom}
          onclick={() => (stake = "custom")}
        >
          Custom
        </button>
      </div>
    </div>

    {#if isCustom}
      <div class="pair">
        <label class="field num">
          Small blind
          <input type="number" min="1" step="1" bind:value={customSb} />
        </label>
        <label class="field num">
          Big blind
          <input type="number" min={smallBlind} step="1" bind:value={customBb} />
        </label>
      </div>
    {/if}

    <div class="field">
      Max seats
      <div class="chips">
        {#each [2, 6, 9] as s}
          <button
            type="button"
            class="chip"
            class:on={maxSeats === s}
            onclick={() => (maxSeats = s)}
          >
            {s}
          </button>
        {/each}
      </div>
    </div>

    <div class="field">
      Buy-in
      {#if canAfford}
        <div class="amount">{buyin.toLocaleString()}</div>

        <input
          class="slider"
          type="range"
          min={rangeMin}
          max={Math.max(rangeMin, buyinMax)}
          step="1"
          bind:value={buyin}
        />

        <div class="bounds">
          <span class="muted">min {rangeMin.toLocaleString()}</span>
          <span class="muted">max {buyinMax.toLocaleString()}</span>
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
        Create table
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: 16px;
  }
  .modal {
    width: 100%;
    max-width: 420px;
    margin: 0;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .x {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--muted);
    font-size: 15px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .x:hover { color: var(--text); }

  .field {
    display: block;
    font-size: 12.5px;
    color: var(--muted);
    margin-bottom: 14px;
  }
  .field input[type="text"],
  .field input[type="number"] {
    width: 100%;
    margin-top: 6px;
  }

  .pair {
    display: flex;
    gap: 10px;
  }
  .pair .num { flex: 1; }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .chip {
    appearance: none;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }
  .chip:hover { border-color: var(--accent); }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #0b0b0b;
    font-weight: 600;
  }

  .amount {
    text-align: center;
    font-size: 30px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
    margin: 8px 0 4px;
  }
  .slider {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .bounds {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    margin: 4px 0 10px;
  }
  .exact {
    width: 100%;
  }

  .short {
    font-size: 13px;
    line-height: 1.5;
    margin: 8px 0 0;
    color: var(--text);
  }
  .short a { color: var(--accent); }

  .wallet {
    font-size: 12px;
    margin-bottom: 14px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions .btn { text-decoration: none; }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
