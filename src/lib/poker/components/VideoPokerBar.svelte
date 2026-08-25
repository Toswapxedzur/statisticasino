<script>
  // Hold-and-draw action bar for Video Poker. The TABLE_TURN carries the player's
  // five cards; tap a card to HOLD it, then Draw to replace the rest:
  //   { type: "draw", holds: [bool × 5] }
  // Reused by any hold-selection game (e.g. Five-Card Draw).

  let { turn, onAct = () => {} } = $props();

  const cards = $derived(turn?.cards || []);
  const bet = $derived(turn?.bet || 0);
  const sig = $derived(cards.join(","));

  let held = $state([false, false, false, false, false]);
  $effect(() => { sig; held = [false, false, false, false, false]; }); // reset on a new hand

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const toggle = (i) => (held = held.map((v, j) => (j === i ? !v : v)));
  function draw() { onAct({ type: "draw", holds: [...held] }); }
</script>

<section class="vpbar">
  <div class="cards">
    {#each cards as c, i}
      <button class="vcard" class:held={held[i]} onclick={() => toggle(i)}>
        <span class="face" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
        <span class="tag">{held[i] ? "HELD" : "hold"}</span>
      </button>
    {/each}
  </div>
  <div class="acts">
    <span class="muted small">bet {bet.toLocaleString()} · tap cards to hold, then draw</span>
    <button class="btn primary" onclick={draw}>Draw</button>
  </div>
</section>

<style>
  .vpbar {
    max-width: 560px; margin: 8px auto 4px; padding: 14px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 12px;
  }
  .cards { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .vcard {
    appearance: none; cursor: pointer; background: transparent;
    border-radius: var(--r-btn); padding: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px;
    transition: transform var(--dur) var(--ease);
  }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 8px; padding: 12px 12px; font-weight: 800; font-size: 22px; line-height: 1;
    box-shadow: var(--shadow-card); min-width: 40px; justify-content: center;
    transition: box-shadow var(--dur) var(--ease);
  }
  .face.red { color: var(--card-red); }
  .suit { font-size: 0.85em; }
  .tag { font-size: 10.5px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
  .vcard.held { transform: translateY(-2px); }
  .vcard.held .tag { color: var(--accent-ink); font-weight: 800; }
  .vcard.held .face { box-shadow: 0 0 0 3px var(--accent), var(--shadow-card); }
  .acts { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .small { font-size: 12px; }
</style>
