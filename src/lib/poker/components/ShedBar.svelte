<script>
  // Your hand for shedding games. Two modes, driven by the turn:
  //  • single-play (Crazy Eights): legal cards highlighted; click one to play it
  //    (an 8 opens a suit picker); Draw when you have nothing.
  //  • combo (Big Two): select any 1–5 cards, then Play, or Pass.

  let { hand = [], turn = null, onAct = () => {} } = $props();

  const myTurn = $derived(!!turn && !!turn.shedGame);
  const combo = $derived(!!turn?.combo);
  const legal = $derived(new Set(turn?.legal || []));
  const canDraw = $derived(!!turn?.canDraw);
  const canPass = $derived(!!turn?.canPass);
  const mustInclude = $derived(turn?.mustInclude || null);

  let pendingEight = $state(null);
  let selected = $state([]);
  const sig = $derived((turn?.hand || hand).join(",") + ":" + myTurn + ":" + combo);
  $effect(() => { sig; selected = []; pendingEight = null; });

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
  function clickCard(c) {
    if (!myTurn) return;
    if (combo) { selected = selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]; return; }
    if (!legal.has(c)) return;
    if (c[0] === "8") { pendingEight = c; return; }
    onAct({ type: "play", card: c });
  }
</script>

<section class="shedbar">
  <div class="lbl">
    {#if !myTurn}Your hand
    {:else if combo}Select cards to play{#if mustInclude} · must include {mustInclude[0]}<span class:red={isRed(mustInclude[1])}>{SUIT[mustInclude[1]]}</span>{/if}
    {:else}{canDraw ? "Nothing to play — draw a card" : "Your turn — play a card"}{/if}
  </div>
  <div class="cards">
    {#each hand as c}
      <button
        class="scard"
        class:playable={myTurn && (combo || legal.has(c))}
        class:sel={combo && selected.includes(c)}
        class:dim={myTurn && !combo && !legal.has(c)}
        onclick={() => clickCard(c)}
        disabled={!myTurn || (!combo && !legal.has(c))}
      >
        <span class="face" class:red={isRed(c[1])}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
      </button>
    {/each}
  </div>

  {#if myTurn && combo}
    <div class="acts">
      {#if canPass}<button class="btn btn-secondary ghost" onclick={() => onAct({ type: "pass" })}>Pass</button>{/if}
      <button class="btn primary" onclick={() => selected.length && onAct({ type: "play", cards: [...selected] })} disabled={!selected.length}>Play {selected.length || ""}</button>
    </div>
  {:else if myTurn && canDraw}
    <div class="acts"><button class="btn primary" onclick={() => onAct({ type: "draw" })}>Draw a card</button></div>
  {/if}

  {#if pendingEight}
    <div class="suitpick">
      <span>Declare a suit:</span>
      {#each ["c", "d", "h", "s"] as su}
        <button class="suitbtn" class:red={isRed(su)} onclick={() => { onAct({ type: "play", card: pendingEight, suit: su }); pendingEight = null; }}>{SUIT[su]}</button>
      {/each}
      <button class="btn btn-secondary ghost" onclick={() => (pendingEight = null)}>Cancel</button>
    </div>
  {/if}
</section>

<style>
  .shedbar {
    max-width: 680px; margin: 8px auto 4px; padding: 12px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 10px;
  }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .lbl .red { color: var(--card-red); }
  .cards { display: flex; gap: 5px; justify-content: center; flex-wrap: wrap; }
  .scard { appearance: none; background: transparent; padding: 0; cursor: default; transition: transform var(--dur) var(--ease); }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 7px; padding: 8px 9px; font-weight: 800; font-size: 17px; line-height: 1;
    box-shadow: var(--shadow-card);
    transition: box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
  }
  .face.red { color: var(--card-red); }
  .suit { font-size: 0.85em; }
  .scard.playable { cursor: pointer; }
  .scard.playable .face { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); }
  .scard.sel { transform: translateY(-8px); }
  .scard.sel .face { box-shadow: 0 0 0 3px var(--gold-ink), var(--shadow-card); }
  .scard.dim .face { opacity: 0.45; }
  .acts { display: flex; gap: 12px; justify-content: center; }
  .suitpick { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 13px; }
  .suitbtn {
    appearance: none; cursor: pointer; background: var(--card-face); color: var(--card-ink);
    border-radius: var(--r-btn); padding: 6px 12px; font-size: 18px; font-weight: 800;
    box-shadow: var(--shadow-card);
    transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .suitbtn:hover { box-shadow: var(--shadow-hover); transform: translateY(-1px); }
  .suitbtn.red { color: var(--card-red); }
</style>
