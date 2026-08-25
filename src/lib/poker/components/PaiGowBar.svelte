<script>
  import { scale, fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Pai Gow set UI: tap two of your seven cards to form the 2-card FRONT hand (the
  // other five are the back), then Set — or Auto for the house way.
  //   { type: "set", front: [c1, c2] }  |  { type: "set", auto: true }

  let { turn, onAct = () => {} } = $props();

  const cards = $derived(turn?.cards || []);
  const sig = $derived(cards.join(","));
  let front = $state([]);
  $effect(() => { sig; front = []; }); // reset on a new deal

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  function toggle(c) {
    if (front.includes(c)) front = front.filter((x) => x !== c);
    else if (front.length < 2) front = [...front, c];
  }
</script>

<section class="pgbar" transition:fly={{ y: d(14), duration: d(DUR.base) }}>
  <div class="lbl">Tap 2 cards for your <strong>front</strong> hand — the other five are your back hand</div>
  <div class="cards">
    {#each cards as c, i (c + '-' + i)}
      <button class="pcard" class:sel={front.includes(c)} onclick={() => toggle(c)}>
        <span class="face" class:red={c[1] === "d" || c[1] === "h"} in:scale={{ start: 0.6, duration: d(DUR.base), delay: d(i * 35) }}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
        <span class="tag">{front.includes(c) ? "FRONT" : ""}</span>
      </button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn btn-secondary" onclick={() => onAct({ type: "set", auto: true })}>Auto (house way)</button>
    <button class="btn primary" onclick={() => front.length === 2 && onAct({ type: "set", front: [...front] })} disabled={front.length !== 2}>Set hand</button>
  </div>
</section>

<style>
  .pgbar {
    max-width: 620px; margin: 8px auto 4px; padding: 14px 16px;
    background: var(--surface); box-shadow: var(--shadow-card);
    border-radius: var(--r-card); display: flex; flex-direction: column; gap: 12px;
  }
  .lbl { font-size: 13px; color: var(--muted); text-align: center; }
  .cards { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .pcard {
    appearance: none; cursor: pointer; background: transparent;
    border-radius: var(--r-btn); padding: 3px; display: flex; flex-direction: column; align-items: center; gap: 3px;
    transition: transform var(--dur) var(--ease);
  }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 7px; padding: 9px 9px; font-weight: 800; font-size: 18px; line-height: 1;
    box-shadow: var(--shadow-card); min-width: 30px; justify-content: center;
    transition: box-shadow var(--dur) var(--ease);
  }
  .face.red { color: var(--card-red); }
  .suit { font-size: 0.85em; }
  .tag { font-size: 9.5px; letter-spacing: 0.5px; height: 12px; color: var(--accent-ink); font-weight: 800; }
  .pcard.sel { transform: translateY(-2px); }
  .pcard.sel .face { box-shadow: 0 0 0 3px var(--accent), var(--shadow-card); }
  .acts { display: flex; gap: 12px; justify-content: center; }
</style>
