<script>
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Shedding-game controls (Crazy Eights, Big Two). The hand is under your seat
  // badge: in single-play mode a tap plays the card (an 8 asks for a suit here);
  // in combo mode taps select and Play sends `selected`.
  let { turn = null, selected = [], pendingEight = null, onAct = () => {}, onCancelEight = () => {} } = $props();

  const myTurn = $derived(!!turn && !!turn.shedGame);
  const combo = $derived(!!turn?.combo);
  const canDraw = $derived(!!turn?.canDraw);
  const canPass = $derived(!!turn?.canPass);
  const mustInclude = $derived(turn?.mustInclude || null);
  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
</script>

<section class="bar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">
    {#if !myTurn}Waiting for your turn…
    {:else if pendingEight}Declare a suit for your 8
    {:else if combo}Select cards under your seat, then Play{#if mustInclude} · must include {mustInclude[0]}<span class:red={isRed(mustInclude[1])}>{SUIT[mustInclude[1]]}</span>{/if}
    {:else}{canDraw ? "Nothing to play — draw a card" : "Your turn — tap a highlighted card to play it"}{/if}
  </div>

  {#if pendingEight}
    <div class="suitpick">
      {#each ["c", "d", "h", "s"] as su}
        <button class="suitbtn" class:red={isRed(su)} onclick={() => onAct({ type: "play", card: pendingEight, suit: su })}>{SUIT[su]}</button>
      {/each}
      <button class="btn btn-secondary" onclick={onCancelEight}>Cancel</button>
    </div>
  {:else if myTurn && combo}
    <div class="acts">
      {#if canPass}<button class="btn btn-secondary" onclick={() => onAct({ type: "pass" })}>Pass</button>{/if}
      <button class="btn primary" onclick={() => selected.length && onAct({ type: "play", cards: [...selected] })} disabled={!selected.length}>Play {selected.length || ""}</button>
    </div>
  {:else if myTurn && canDraw}
    <div class="acts"><button class="btn primary" onclick={() => onAct({ type: "draw" })}>Draw a card</button></div>
  {/if}
</section>

<style>
  .bar { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .red { color: var(--card-red); }
  .acts { display: flex; gap: 12px; justify-content: center; }
  .suitpick { display: flex; gap: 8px; align-items: center; }
  .suitbtn { width: 44px; height: 44px; border-radius: 10px; border: 0; background: var(--card-face); color: var(--card-ink); font-size: 24px; cursor: pointer; box-shadow: var(--shadow-card); }
  .suitbtn.red { color: var(--card-red); }
</style>
