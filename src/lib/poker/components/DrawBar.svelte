<script>
  // Five-Card Draw action bar: tap cards to DISCARD, then Draw (or Stand pat).
  // Emits { type: "draw", discards: number[] }. Cards come from the private frame.

  let { cards = [], onAct = () => {} } = $props();

  const sig = $derived(cards.join(","));
  let discard = $state([]);
  $effect(() => { sig; discard = []; }); // reset on a fresh deal

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const toggle = (i) => (discard = discard.includes(i) ? discard.filter((x) => x !== i) : [...discard, i]);
</script>

<section class="drawbar">
  <div class="lbl">Tap cards to discard, then Draw — or stand pat</div>
  <div class="cards">
    {#each cards as c, i}
      <button class="dcard" class:disc={discard.includes(i)} onclick={() => toggle(i)}>
        <span class="face" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
        <span class="tag">{discard.includes(i) ? "DISCARD" : "keep"}</span>
      </button>
    {/each}
  </div>
  <div class="acts">
    <button class="btn" onclick={() => onAct({ type: "draw", discards: [] })}>Stand pat</button>
    <button class="btn primary" onclick={() => onAct({ type: "draw", discards: [...discard] })}>Draw {discard.length}</button>
  </div>
</section>

<style>
  .drawbar {
    max-width: 560px; margin: 8px auto 4px; padding: 14px 16px;
    background: var(--surface, #16161c); border: 1px solid var(--border, #333);
    border-radius: 12px; display: flex; flex-direction: column; gap: 12px;
  }
  .lbl { font-size: 13px; color: var(--muted, #9aa); text-align: center; }
  .cards { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .dcard {
    appearance: none; cursor: pointer; border: 2px solid transparent; background: transparent;
    border-radius: 10px; padding: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .face {
    display: inline-flex; align-items: center; gap: 1px; background: #fbfbfd; color: #1a1a1a;
    border-radius: 8px; padding: 12px; font-weight: 800; font-size: 22px; line-height: 1;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3); min-width: 40px; justify-content: center;
  }
  .face.red { color: #c0392b; }
  .suit { font-size: 0.85em; }
  .tag { font-size: 10.5px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted, #9aa); }
  .dcard.disc .face { box-shadow: 0 0 0 3px rgba(224,85,95,0.6), 0 2px 6px rgba(0,0,0,0.3); opacity: 0.6; }
  .dcard.disc .tag { color: #e0555f; font-weight: 800; }
  .acts { display: flex; gap: 12px; justify-content: center; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
</style>
