<script>
  // Tri-state checkbox for the player/table parent rows in the
  // /data tree. Three external triState values drive the visual:
  //
  //   "all"   -> checked
  //   "some"  -> indeterminate (visible "−" cue)
  //   "none"  -> unchecked
  //
  // The prop is deliberately NOT called `state` — Svelte 5 special-
  // cases that identifier (it overlaps with the `$state` rune) and
  // can rewrite plain reads into `store_get(...)` calls in the
  // compiled SSR output, blowing up at render time.
  //
  // We can't use `bind:checked={triState === 'all'}` because clicks
  // on an indeterminate box should "select all children" rather
  // than simply flip checked, and `bind:` would race the manual
  // logic. Instead we set checked + indeterminate via a $effect
  // that re-runs whenever the prop changes, and we own the click
  // handler ourselves.
  //
  // KNOWN QUIRK (2026-05-22): on the clicked checkbox specifically,
  // some actor between Svelte's flush and the next browser paint
  // resets `.checked` and `.indeterminate` back to false. The other
  // tristates on the page (which receive the same `selected` write
  // but were not the click target) update correctly. We diagnosed
  // it via DRIFT logs and were unable to identify the culprit
  // (MutationObserver on attributes did not fire, no node
  // replacement was observed). The defensive fix is to re-apply
  // the property writes on the next animation frame — invisible
  // to the user, costs one rAF + two property assignments per
  // click. Remove the rAF re-apply if a future Svelte version
  // makes this unnecessary.

  let { triState, title = "", onToggle } = $props();

  let inputEl;

  $effect(() => {
    if (!inputEl) return;
    const c = triState === "all";
    const i = triState === "some";
    inputEl.checked = c;
    inputEl.indeterminate = i;
    // Defensive re-apply on the next frame — see KNOWN QUIRK above.
    const node = inputEl;
    requestAnimationFrame(() => {
      if (node.checked !== c)        node.checked = c;
      if (node.indeterminate !== i)  node.indeterminate = i;
    });
  });

  function handleClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    // Click cycles between "all" and "none" (children fully selected
    // or fully cleared). "some" is a derived display state — clicking
    // an indeterminate box behaves the same as clicking an empty one
    // (i.e. "select everything"), matching the standard tri-state
    // pattern in macOS / Windows file pickers.
    onToggle(triState !== "all");
  }
</script>

<label class="tree-select" {title}>
  <input
    type="checkbox"
    bind:this={inputEl}
    onclick={handleClick}
  />
</label>

<style>
  .tree-select {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .tree-select input[type="checkbox"] {
    accent-color: var(--hero);
    cursor: pointer;
  }
</style>
