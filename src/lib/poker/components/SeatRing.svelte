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

  // THE STAGE (owner, 2026-09-26: nothing on the table may move because something else changed size).
  // The arena is a FIXED-size stage in design pixels — wide for landscape windows, tall for portrait
  // phones — scaled as a whole to fit its box (letterboxed), so seat positions are fixed coordinates.
  // Only a window resize can change the scale or the shape; nothing during play can.
  // spread = the ring's half-width (% of the stage) so the side seats' fixed plates stay on the stage
  // plates are back to their compact size (owner, 2026-09-26); the ring overhangs them
  const STAGES = { wide: { w: 1120, h: 660, plate: 152, mine: 184, spread: 41 }, tall: { w: 640, h: 940, plate: 144, mine: 172, spread: 36 } };
  let el = $state(null);
  let shape = $state("wide");
  let zoom = $state(1);
  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width, h = e.contentRect.height;
      if (!w || !h) return;
      shape = w / h < 0.85 ? "tall" : "wide";
      const st = STAGES[shape];
      zoom = Math.max(0.3, Math.min(w / st.w, h / st.h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  let stage = $derived(STAGES[shape]);
  let positions = $derived(ringPositions(ring, mySeatNo, !!top, flat, STAGES[shape].spread));

</script>

<div class="arena-fit" bind:this={el}>
<div class="arena" style="width:{stage.w}px;height:{stage.h}px;zoom:{zoom};--plate-w:{stage.plate}px;--plate-w-mine:{stage.mine}px">
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
  .arena-fit { position: relative; width: 100%; height: 100%; display: grid; place-items: center; }
  /* fixed size, and nothing inside can resize it (contain) */
  .arena { position: relative; flex: none; contain: layout size style; }
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
