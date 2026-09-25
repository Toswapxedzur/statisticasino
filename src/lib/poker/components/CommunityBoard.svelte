<script>
  import Card from "./Card.svelte";
  import Num from "./Num.svelte";
  import CoinStack from "./CoinStack.svelte";
  import { scale, fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // The community cards and the central pot pill.
  //  board     — string[] of revealed community cards (0..5).
  //  potTotal  — total chips in the pot (number).
  //  street    — current street label for context (optional).
  //  result    — null | { type, board, winners:[{seat,amount}], revealed:[] }.
  //              When present the pot pill shows the outcome briefly.
  //  dealt     — null (cards just appear) | { shown, faceUp, hidden } from the table's Dealer:
  //              slots ≥ shown stay empty (the card is still in the air), slots ≥ faceUp show
  //              the back, and `hidden` blanks the board while the canvas collects it.
  let { board = [], potTotal = 0, street = null, result = null, size = "md", width = null, dealt = null } = $props();

  // Always render five slots; fill from board, leave the rest as empty slots.
  let slots = $derived(Array.from({ length: 5 }, (_, i) => board[i] ?? null));

  let wonAmount = $derived(
    result?.winners?.length
      ? result.winners.reduce((s, w) => s + (w.amount || 0), 0)
      : 0,
  );

  function fmt(n) {
    return typeof n === "number" ? n.toLocaleString() : n;
  }
</script>

<div class="board">
  <div class="slots">
    {#each slots as c, i}
      <span class="bslot" data-board-slot={i}>
        {#if c && dealt}
          {#if i < dealt.shown && !dealt.hidden}
            <span class="flip" class:up={i < dealt.faceUp}>
              <span class="face back"><Card faceDown {size} {width} /></span>
              <span class="face front"><Card card={c} {size} {width} /></span>
            </span>
          {:else}
            <Card {size} {width} />
          {/if}
        {:else if c}
          <span class="deal" in:scale={{ start: 0.6, duration: d(DUR.base), delay: d(i * 45) }}><Card card={c} {size} {width} /></span>
        {:else}
          <Card {size} {width} />
        {/if}
      </span>
    {/each}
  </div>

  <div class="pot" class:result={!!result}>
    {#if (result ? (wonAmount || potTotal) : potTotal) > 0}
      <span class="pot-chip"><CoinStack value={result ? (wonAmount || potTotal) : potTotal} size={20} /></span>
    {/if}
    {#if result}
      <span class="pot-lbl">{result.type === "showdown" ? "Showdown" : "Winner"}</span>
      <span class="pot-amt"><Num value={wonAmount || potTotal} /></span>
    {:else}
      <span class="pot-lbl">Pot</span>
      <span class="pot-amt"><Num value={potTotal} /></span>
      {#if street}<span class="street">{street}</span>{/if}
    {/if}
  </div>
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .slots { display: flex; gap: 6px; }
  .deal { line-height: 0; display: inline-flex; }
  .bslot { line-height: 0; display: inline-flex; position: relative; }
  /* dealt cards: land face-down, then turn over (the flop's three together) */
  .flip { position: relative; display: inline-flex; line-height: 0; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.4, 0.85, 0.35, 1); }
  .flip.up { transform: rotateY(180deg); }
  .face { line-height: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .face.front { position: absolute; inset: 0; transform: rotateY(180deg); }
  @media (prefers-reduced-motion: reduce) { .flip { transition: none; } }

  .pot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 15px;
    background: var(--surface);
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-card);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    transition: box-shadow var(--dur) var(--ease);
  }
  .pot-chip { line-height: 0; display: inline-flex; margin-right: -2px; }
  .pot-lbl {
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
    text-transform: uppercase; color: var(--muted);
  }
  .pot-amt { font-size: 16px; font-weight: 800; color: var(--gold-ink); }
  .street {
    font-size: 10px; text-transform: capitalize; color: var(--muted);
    padding-left: 8px;
  }
  .pot.result {
    box-shadow: 0 0 0 2px var(--ok), var(--shadow-card);
  }
  .pot.result .pot-lbl { color: var(--ok); }
  .pot.result .pot-amt { color: var(--ok); }
</style>
