<script>
  // Fully custom dropdown — no native <select>. Keyboard-accessible (Enter/Space/
  // arrows/Esc), closes on outside-click, themed + borderless. When `name` is set
  // it mirrors the value into a hidden input so it works inside a <form> POST.
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  let {
    options = [],            // [{ value, label }]
    value = $bindable(),
    name = null,
    placeholder = "Select…",
    ariaLabel = "Select",
    onChange = null,
    block = false,
  } = $props();

  let open = $state(false);
  let cursor = $state(-1);
  let rootEl;
  const selected = $derived(options.find((o) => o.value === value) || null);

  function openMenu() { open = true; cursor = options.findIndex((o) => o.value === value); }
  function close() { open = false; }
  function pick(o) { value = o.value; onChange?.(o.value); close(); rootEl?.querySelector(".sel-trigger")?.focus(); }

  function onKey(e) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); cursor = (cursor + 1) % options.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); cursor = (cursor - 1 + options.length) % options.length; }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (cursor >= 0) pick(options[cursor]); }
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    const onDoc = (e) => { if (open && rootEl && !rootEl.contains(e.target)) close(); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  });
</script>

<div class="sel" class:block bind:this={rootEl}>
  {#if name}<input type="hidden" {name} value={value ?? ""} />{/if}
  <button type="button" class="sel-trigger" onclick={() => (open ? close() : openMenu())} onkeydown={onKey}
    aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
    <span class="sel-value" class:placeholder={!selected}>{selected ? selected.label : placeholder}</span>
    <span class="sel-chevron" class:open></span>
  </button>
  {#if open}
    <ul class="sel-list" role="listbox" tabindex="-1" transition:fly={{ y: d(-6), duration: d(DUR.fast) }}>
      {#each options as o, i (o.value)}
        <li role="option" aria-selected={o.value === value} class="sel-opt" class:on={o.value === value} class:cursor={i === cursor}
          onmouseenter={() => (cursor = i)} onclick={() => pick(o)}>
          {o.label}{#if o.value === value}<span class="sel-check">✓</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sel { position: relative; display: inline-block; }
  .sel.block { display: block; }
  .sel-trigger {
    display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
    background: var(--well); color: var(--text); border: 0; border-radius: var(--r-btn);
    padding: 9px 12px; font: inherit; cursor: pointer; min-width: 120px;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  }
  .sel-trigger:hover { background: var(--surface-2); }
  .sel-value.placeholder { color: var(--muted); }
  .sel-chevron { width: 8px; height: 8px; flex: 0 0 auto; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
    transform: rotate(45deg) translateY(-2px); transition: transform var(--dur) var(--ease); }
  .sel-chevron.open { transform: rotate(-135deg) translateY(-2px); }
  .sel-list {
    position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; min-width: 100%; margin: 0; padding: 5px; list-style: none;
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-panel); max-height: 260px; overflow-y: auto;
  }
  .sel-opt {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 11px; border-radius: var(--r-btn); font-size: 13.5px; cursor: pointer; white-space: nowrap;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .sel-opt.cursor { background: var(--well); }
  .sel-opt.on { color: var(--accent-ink); font-weight: 600; }
  .sel-check { color: var(--accent-ink); font-weight: 800; }
</style>
