<script>
  import { fade, scale } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import { untrack } from "svelte";
  // Rebuy: top my stack up to the table's cap. max = the room left under the cap.
  //   onConfirm(amount)  -> the rebuy
  //   onCancel()         -> dismiss
  let { config, max, onConfirm, onCancel } = $props();

  const lo = $derived(Math.min(config.bigBlind ?? 1, max));
  // starts at 20 big blinds (within the table's range), then it's the player's
  let amount = $state(untrack(() => Math.min(max, Math.max(config.minBuyin, config.bigBlind * 20))));
  const fill = $derived(max > lo ? ((amount - lo) / (max - lo)) * 100 : 0);

  function confirm() {
    const amt = Math.max(1, Math.min(max, Math.round(amount)));
    if (amt > 0) onConfirm(amt);
  }
</script>

<div class="modal-backdrop" onclick={onCancel} role="presentation" transition:fade={{ duration: d(DUR.fast) }}>
  <div class="modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rebuy" transition:scale={{ start: 0.96, duration: d(DUR.base) }}>
    <h3>Rebuy</h3>
    <p class="muted small">Top up your stack (max {max.toLocaleString()} to reach the table cap).</p>
    <input class="rng" type="range" style="--fill:{fill}%" min={lo} {max} step={config.bigBlind || 1} bind:value={amount} />
    <input class="num" type="number" min="1" {max} bind:value={amount} />
    <div class="modal-actions">
      <button class="btn ghost" onclick={onCancel}>Cancel</button>
      <button class="btn primary" onclick={confirm} disabled={amount <= 0}>Rebuy {Math.round(amount).toLocaleString()}</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
  .modal { width: min(420px, 94vw); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .modal h3 { margin: 0; }
  .modal .num { width: 100%; padding: 9px 11px; border-radius: var(--r-btn); border: 0; background: var(--well); color: var(--text); }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
  .small { font-size: 12px; opacity: 0.8; }
  .btn.primary { background: var(--accent); color: var(--on-accent); }
  .btn.ghost { background: var(--well); box-shadow: none; }
</style>
