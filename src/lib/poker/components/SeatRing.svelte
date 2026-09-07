<script>
  // The arena every game shares: seats on an ellipse (mine at bottom centre, the
  // rest clockwise), an optional House slot at the top, and a centre area.
  //   seatNos   — the seat numbers to place (players only).
  //   mySeatNo  — anchors the rotation (null → seat 0 at the bottom).
  //   houseSeat — seat number rendered at the top centre instead of on the ring.
  //   seat      — snippet(seatNo) rendering one seat.
  //   center    — snippet rendering the middle (board, dealer cards, pile …).
  //   top       — optional snippet rendered at the top centre (the House).
  let { seatNos = [], mySeatNo = null, seat, center, top = null, houseSeat = null, flat = false } = $props();

  import { ringPositions } from "$lib/poker/ring.js";
  let ring = $derived(seatNos.filter((n) => n !== houseSeat));
  let positions = $derived(ringPositions(ring, mySeatNo, !!top, flat));

  // Scale the whole arena with the space it gets: badges and cards are laid out in
  // px for a ~1100×640 reference; bigger screens zoom in, phones zoom out.
  let el = $state(null);
  let zoom = $state(1);
  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width, h = e.contentRect.height;
      zoom = Math.max(0.7, Math.min(1.7, Math.min(w / 1100, h / 600)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

<div class="arena-fit" bind:this={el}>
<div class="arena" style="zoom:{zoom}">
  <div class="ambient" aria-hidden="true"></div>
  {#if top}
    <div class="top">{@render top()}</div>
  {/if}
  <div class="center">{@render center()}</div>
  {#each positions as p (p.seatNo)}
    <div class="slot" class:bottom={p.bottom} style="left:{p.x}%; top:{p.y}%;">
      {@render seat(p.seatNo, p.bottom)}
    </div>
  {/each}
</div>
</div>

<style>
  .arena-fit { position: relative; width: 100%; height: 100%; min-height: 420px; }
  .arena { position: relative; width: 100%; height: 100%; }
  .ambient {
    position: absolute; inset: 8% 12%; z-index: 0; pointer-events: none; border-radius: 50%;
    background:
      radial-gradient(60% 60% at 50% 46%, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%),
      radial-gradient(42% 42% at 50% 50%, color-mix(in srgb, var(--gold) 10%, transparent) 0%, transparent 65%);
    filter: blur(6px);
  }
  .top { position: absolute; left: 50%; top: 4%; transform: translateX(-50%); z-index: 2; }
  .center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .slot { position: absolute; transform: translate(-50%, -50%); z-index: 2; }
  .slot.bottom { z-index: 3; transform: translate(-50%, -62%); }
</style>
