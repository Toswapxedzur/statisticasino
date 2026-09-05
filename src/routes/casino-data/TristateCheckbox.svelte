<script>
  // Tri-state selector for the player/table parent rows in the /data tree.
  //   "all"  -> check   |   "some" -> dash (indeterminate)   |   "none" -> empty
  // Custom (no native <input type=checkbox>), which also retires the old
  // native-checkbox rAF re-apply hack. Clicking cycles all <-> none.
  let { triState, title = "", onToggle } = $props();
  function handleClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    onToggle(triState !== "all");
  }
</script>

<button type="button" class="tri {triState}" {title}
  role="checkbox" aria-checked={triState === "all" ? "true" : triState === "some" ? "mixed" : "false"}
  onclick={handleClick}>
  <span class="tri-box">
    {#if triState === "all"}<span class="tri-tick"></span>{:else if triState === "some"}<span class="tri-dash"></span>{/if}
  </span>
</button>

<style>
  .tri { background: transparent; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center; }
  .tri-box { width: 20px; height: 20px; border-radius: 6px; background: var(--well); display: grid; place-items: center;
    transition: background-color var(--dur) var(--ease); }
  .tri.all .tri-box, .tri.some .tri-box { background: var(--accent); }
  .tri-tick { width: 6px; height: 10px; border-right: 2px solid var(--on-accent); border-bottom: 2px solid var(--on-accent); transform: rotate(45deg) translateY(-1px); }
  .tri-dash { width: 10px; height: 2px; background: var(--on-accent); border-radius: 2px; }
</style>
