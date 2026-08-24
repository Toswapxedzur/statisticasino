<script>
  // Your hand for shedding games. Always shows your cards; on your turn the legal
  // cards are highlighted and clickable (an 8 opens a suit picker), with a Draw
  // button when you have nothing to play.
  //   { type: "play", card, suit? }  |  { type: "draw" }

  let { hand = [], turn = null, onAct = () => {} } = $props();

  const myTurn = $derived(!!turn && !!turn.shedGame);
  const legal = $derived(new Set(turn?.legal || []));
  const canDraw = $derived(!!turn?.canDraw);
  let pendingEight = $state(null);
  $effect(() => { if (!myTurn) pendingEight = null; });

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
  function clickCard(c) {
    if (!myTurn || !legal.has(c)) return;
    if (c[0] === "8") { pendingEight = c; return; }
    onAct({ type: "play", card: c });
  }
</script>

<section class="shedbar">
  <div class="lbl">
    {#if myTurn}{canDraw ? "Nothing to play — draw a card" : "Your turn — play a card"}{:else}Your hand{/if}
  </div>
  <div class="cards">
    {#each hand as c}
      <button
        class="scard"
        class:playable={myTurn && legal.has(c)}
        class:dim={myTurn && !legal.has(c)}
        onclick={() => clickCard(c)}
        disabled={!myTurn || !legal.has(c)}
      >
        <span class="face" class:red={isRed(c[1])}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
      </button>
    {/each}
  </div>
  {#if myTurn && canDraw}
    <div class="acts"><button class="btn primary" onclick={() => onAct({ type: "draw" })}>Draw a card</button></div>
  {/if}
  {#if pendingEight}
    <div class="suitpick">
      <span>Declare a suit:</span>
      {#each ["c", "d", "h", "s"] as su}
        <button class="suitbtn" class:red={isRed(su)} onclick={() => { onAct({ type: "play", card: pendingEight, suit: su }); pendingEight = null; }}>{SUIT[su]}</button>
      {/each}
      <button class="btn ghost" onclick={() => (pendingEight = null)}>Cancel</button>
    </div>
  {/if}
</section>

<style>
  .shedbar {
    max-width: 640px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface, #16161c); border: 1px solid var(--border, #333);
    border-radius: 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .lbl { font-size: 13px; color: var(--muted, #9aa); text-align: center; }
  .cards { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
  .scard { appearance: none; background: transparent; border: none; padding: 0; cursor: default; }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: #fbfbfd; color: #1a1a1a;
    border-radius: 7px; padding: 9px 10px; font-weight: 800; font-size: 18px; line-height: 1;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3); border: 2px solid transparent;
  }
  .face.red { color: #c0392b; }
  .suit { font-size: 0.85em; }
  .scard.playable { cursor: pointer; }
  .scard.playable .face { border-color: var(--accent, #6cf); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #6cf) 35%, transparent), 0 2px 5px rgba(0,0,0,0.3); }
  .scard.dim .face { opacity: 0.45; }
  .acts { display: flex; justify-content: center; }
  .suitpick { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 13px; }
  .suitbtn {
    appearance: none; cursor: pointer; border: 1px solid var(--border, #333); background: #fbfbfd; color: #1a1a1a;
    border-radius: 8px; padding: 6px 12px; font-size: 18px; font-weight: 800;
  }
  .suitbtn.red { color: #c0392b; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
  .btn.ghost { background: transparent; }
</style>
