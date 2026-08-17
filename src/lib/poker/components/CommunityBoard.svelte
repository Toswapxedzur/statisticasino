<script>
  import Card from "./Card.svelte";

  // The community cards and the central pot pill.
  //  board     — string[] of revealed community cards (0..5).
  //  potTotal  — total chips in the pot (number).
  //  street    — current street label for context (optional).
  //  result    — null | { type, board, winners:[{seat,amount}], revealed:[] }.
  //              When present the pot pill shows the outcome briefly.
  let { board = [], potTotal = 0, street = null, result = null } = $props();

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
      {#if c}
        <Card card={c} size="md" />
      {:else}
        <Card size="md" />
      {/if}
    {/each}
  </div>

  <div class="pot" class:result={!!result}>
    {#if result}
      <span class="pot-lbl">{result.type === "showdown" ? "Showdown" : "Winner"}</span>
      <span class="pot-amt">{fmt(wonAmount || potTotal)}</span>
    {:else}
      <span class="pot-lbl">Pot</span>
      <span class="pot-amt">{fmt(potTotal)}</span>
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

  .pot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 14px;
    background: rgba(0, 0, 0, 0.42);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.4);
    color: #eaf3ee;
    font-variant-numeric: tabular-nums;
  }
  .pot-lbl {
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
    text-transform: uppercase; color: #b9cabb;
  }
  .pot-amt { font-size: 16px; font-weight: 800; }
  .street {
    font-size: 10px; text-transform: capitalize; color: #9fb3a4;
    padding-left: 6px; border-left: 1px solid rgba(255,255,255,0.15);
  }
  .pot.result {
    border-color: rgba(74, 222, 128, 0.55);
    box-shadow: 0 0 16px rgba(74, 222, 128, 0.35);
  }
  .pot.result .pot-lbl { color: var(--ok, #4ade80); }
</style>
