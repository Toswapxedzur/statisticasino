<script>
  // Buy-in modal (DESIGN.md §3). Pick an amount via slider between
  // config.minBuyin and min(config.maxBuyin, walletChips), then confirm
  // for the chosen seat.
  //
  //   onConfirm(amount)  -> commit the buy-in for `seat`
  //   onCancel()         -> dismiss without seating
  //
  // If the user can't cover the minimum buy-in, confirm is disabled and
  // we point them at the chip cashier instead.

  let { config, walletChips, seat, onConfirm, onCancel } = $props();

  const min = $derived(config.minBuyin);
  // Never let the slider exceed either the table max or the user's balance.
  const max = $derived(Math.min(config.maxBuyin, walletChips ?? 0));
  const canAfford = $derived((walletChips ?? 0) >= min);

  // Default to the table max (capped by wallet) — the common choice.
  let amount = $state(0);

  $effect(() => {
    // Clamp whenever the bounds change (e.g. wallet balance updates).
    const lo = min;
    const hi = Math.max(min, max);
    if (amount < lo || amount > hi || amount === 0) {
      amount = canAfford ? hi : lo;
    }
  });

  function confirm() {
    if (!canAfford) return;
    const clamped = Math.max(min, Math.min(max, Math.round(amount)));
    onConfirm(clamped);
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
    aria-label="Buy in"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="card-head">
      <h3>Buy in — seat {seat}</h3>
      <button class="x" aria-label="Close" onclick={onCancel}>✕</button>
    </div>

    <p class="muted sub">
      {config.name} · blinds {config.smallBlind}/{config.bigBlind}
    </p>

    {#if canAfford}
      <div class="amount">{amount.toLocaleString()}</div>
      <div class="muted amount-label">chips at the table</div>

      <input
        class="slider"
        type="range"
        min={min}
        max={Math.max(min, max)}
        step="1"
        bind:value={amount}
      />

      <div class="bounds">
        <span class="muted">min {min.toLocaleString()}</span>
        <span class="muted">max {max.toLocaleString()}</span>
      </div>

      <label class="field num">
        Exact amount
        <input
          type="text"
          inputmode="numeric"
          value={amount}
          oninput={(e) => {
            const n = parseInt(e.currentTarget.value.replace(/[^0-9]/g, ""), 10);
            amount = Number.isFinite(n) ? n : min;
          }}
        />
      </label>

      <div class="wallet muted">Wallet balance: {(walletChips ?? 0).toLocaleString()}</div>

      <div class="actions">
        <button class="btn btn-secondary" onclick={onCancel}>Cancel</button>
        <button class="btn" onclick={confirm}>
          Buy in {amount.toLocaleString()}
        </button>
      </div>
    {:else}
      <p class="short">
        You need at least <strong>{min.toLocaleString()}</strong> chips to sit at
        this table, but your wallet only has
        <strong>{(walletChips ?? 0).toLocaleString()}</strong>.
      </p>
      <div class="actions">
        <button class="btn btn-secondary" onclick={onCancel}>Cancel</button>
        <a class="btn" href="/account">Get chips</a>
      </div>
    {/if}
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
    max-width: 380px;
    margin: 0;
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
  .sub { margin: 0 0 14px; font-size: 12.5px; }
  .amount {
    text-align: center;
    font-size: 34px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  .amount-label {
    text-align: center;
    font-size: 11.5px;
    margin-bottom: 14px;
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
    margin: 4px 0 12px;
  }
  .num { margin-bottom: 8px; }
  .num input { width: 100%; }
  .wallet {
    font-size: 12px;
    margin-bottom: 14px;
  }
  .short {
    font-size: 13px;
    line-height: 1.5;
    margin: 4px 0 16px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions .btn { text-decoration: none; }
</style>
