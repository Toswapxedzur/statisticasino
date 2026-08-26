<script>
  // Custom checkbox — no native <input type=checkbox>. Bindable `checked`,
  // keyboard-accessible (it's a real button with role=checkbox), themed.
  let { checked = $bindable(false), label = "", disabled = false, onChange = null } = $props();
  // Controlled when onChange is given (parent owns `checked`); otherwise bindable.
  function toggle() {
    if (disabled) return;
    const next = !checked;
    if (onChange) onChange(next); else checked = next;
  }
</script>

<button type="button" class="cb" class:on={checked} role="checkbox" aria-checked={checked} aria-label={label || undefined} {disabled} onclick={toggle}>
  <span class="cb-box">{#if checked}<span class="cb-tick"></span>{/if}</span>
  {#if label}<span class="cb-label">{label}</span>{/if}
</button>

<style>
  .cb { display: inline-flex; align-items: center; gap: 9px; background: transparent; border: 0; cursor: pointer; color: var(--text); font: inherit; padding: 0; text-align: left; }
  .cb[disabled] { opacity: .5; cursor: not-allowed; }
  .cb-box { width: 20px; height: 20px; border-radius: 6px; background: var(--well); display: grid; place-items: center; flex: 0 0 auto;
    transition: background-color var(--dur) var(--ease); }
  .cb.on .cb-box { background: var(--accent); }
  .cb-tick { width: 6px; height: 10px; border-right: 2px solid var(--on-accent); border-bottom: 2px solid var(--on-accent); transform: rotate(45deg) translateY(-1px); }
  .cb-label { font-size: 13px; line-height: 1.35; }
</style>
