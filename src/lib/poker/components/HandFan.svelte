<script>
  import Card from "./Card.svelte";
  import { fly, fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // A hand of cards under a seat badge.
  //   cards      — string[] (face up) | null; with `count` > 0 and no cards, backs.
  //   count      — number of face-down cards to show when `cards` is null.
  //   width      — card width in px (height follows the 60:78 card ratio).
  //   fan        — how to lay them out: "auto" (≤2 side by side, more overlapped),
  //                "row" (never overlap) or "stack" (always overlap).
  //   selectable — { selected: Set<key>, legal: Set<key>|null, keyOf(i, card) } | null.
  //                Clicking a card calls onSelect(key, i, card). Selected cards lift.
  //   labelOf    — optional (i, card) => short label shown over a selected card.
  let {
    cards = null, count = 0, width = 42, fan = "auto",
    selectable = null, onSelect = () => {}, labelOf = null, reveal = true
  } = $props();

  const HIDDEN = (c) => c == null || c === "??" || c === "X" || c === "?";
  let faces = $derived(Array.isArray(cards) && cards.length ? cards.map((c) => (HIDDEN(c) ? null : c)) : null);
  let n = $derived(faces ? faces.length : count);
  let h = $derived(Math.round((width * 78) / 60));
  let overlap = $derived(fan === "row" ? false : fan === "stack" ? true : n > 2);
  // Visible strip of each overlapped card: 38% of its width (the last card shows fully).
  let step = $derived(overlap ? Math.round(width * 0.38) : width + Math.max(3, Math.round(width * 0.06)));
  let total = $derived(n ? (n - 1) * step + width : 0);
  const keyOf = (i, c) => (selectable?.keyOf ? selectable.keyOf(i, c) : (c ?? i));
</script>

{#if n > 0}
  <div class="fan" style="width:{total}px;height:{h + (selectable ? 14 : 0)}px;--w:{width}px;--h:{h}px" in:fly={{ y: d(-10), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}>
    {#each Array.from({ length: n }) as _, i (faces ? faces[i] + "-" + i : i)}
      {@const c = faces ? faces[i] : null}
      {@const k = keyOf(i, c)}
      {@const sel = !!selectable?.selected?.has(k)}
      {@const legal = selectable ? (selectable.legal ? selectable.legal.has(k) : true) : false}
      {#if selectable}
        <button type="button" class="slot pick" class:sel class:dim={selectable.legal && !legal} style="left:{i * step}px;--i:{i}" onclick={() => onSelect(k, i, c)} data-sfx="none" disabled={selectable.legal ? !legal : false}>
          <span class="flip" class:up={!!c && reveal}>
            <span class="face back"><Card faceDown width={width} /></span>
            <span class="face front">{#if c}<Card card={c} width={width} />{/if}</span>
          </span>
          {#if sel && labelOf}<span class="lbl">{labelOf(i, c)}</span>{/if}
        </button>
      {:else}
        <span class="slot" style="left:{i * step}px;--i:{i}">
          <span class="flip" class:up={!!c && reveal}>
            <span class="face back"><Card faceDown width={width} /></span>
            <span class="face front">{#if c}<Card card={c} width={width} />{/if}</span>
          </span>
        </span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .fan { position: relative; display: block; }
  .slot {
    position: absolute; top: 0; width: var(--w); height: var(--h);
    line-height: 0; z-index: calc(1 + var(--i));
    filter: drop-shadow(-2px 0 2px rgba(0, 0, 0, 0.35));
  }
  .slot.pick {
    appearance: none; background: transparent; border: 0; padding: 0; cursor: pointer;
    transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
  }
  .slot.pick:hover:not(:disabled) { transform: translateY(-6px); }
  .slot.pick.sel { transform: translateY(-14px); }
  .slot.pick.sel .front :global(.card-wrap) { box-shadow: 0 0 0 3px var(--accent); border-radius: 7px; }
  .slot.pick.dim { opacity: 0.45; cursor: default; }
  .flip {
    position: absolute; inset: 0; display: block;
    transform-style: preserve-3d;
    transition: transform 0.5s cubic-bezier(0.4, 0.85, 0.35, 1);
    transition-delay: calc(var(--i) * 0.06s);
  }
  .flip.up { transform: rotateY(180deg); }
  .face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; line-height: 0; }
  .face.front { transform: rotateY(180deg); }
  .lbl {
    position: absolute; left: 50%; bottom: -14px; transform: translateX(-50%);
    font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
    color: var(--accent-ink); white-space: nowrap; line-height: 1;
  }
  @media (prefers-reduced-motion: reduce) { .flip { transition: none; } }
</style>
