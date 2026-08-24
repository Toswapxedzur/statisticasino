<script>
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

<section class="pgbar">
  <div class="lbl">Tap 2 cards for your <strong>front</strong> hand — the other five are your back hand</div>
  <div class="cards">
    {#each cards as c}
      <button class="pcard" class:sel={front.includes(c)} onclick={() => toggle(c)}>
        <span class="face" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
        <span class="tag">{front.includes(c) ? "FRONT" : ""}</span>
      </button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn" onclick={() => onAct({ type: "set", auto: true })}>Auto (house way)</button>
    <button class="btn primary" onclick={() => front.length === 2 && onAct({ type: "set", front: [...front] })} disabled={front.length !== 2}>Set hand</button>
  </div>
</section>

<style>
  .pgbar {
    max-width: 620px; margin: 8px auto 4px; padding: 14px 16px;
    background: var(--surface, #16161c); border: 1px solid var(--border, #333);
    border-radius: 12px; display: flex; flex-direction: column; gap: 12px;
  }
  .lbl { font-size: 13px; color: var(--muted, #9aa); text-align: center; }
  .cards { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .pcard {
    appearance: none; cursor: pointer; border: 2px solid transparent; background: transparent;
    border-radius: 10px; padding: 3px; display: flex; flex-direction: column; align-items: center; gap: 3px;
  }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: #fbfbfd; color: #1a1a1a;
    border-radius: 7px; padding: 9px 9px; font-weight: 800; font-size: 18px; line-height: 1;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3); min-width: 30px; justify-content: center;
  }
  .face.red { color: #c0392b; }
  .suit { font-size: 0.85em; }
  .tag { font-size: 9.5px; letter-spacing: 0.5px; height: 12px; color: var(--accent, #6cf); font-weight: 800; }
  .pcard.sel { border-color: var(--accent, #6cf); }
  .pcard.sel .face { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #6cf) 40%, transparent), 0 2px 5px rgba(0,0,0,0.3); }
  .acts { display: flex; gap: 12px; justify-content: center; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
