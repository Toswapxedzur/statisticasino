<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import CommunityBoard from "./CommunityBoard.svelte";
  import Chip from "./Chip.svelte";
  import { reducedMotion } from "$lib/motion.js";
  import { ringPositions } from "$lib/poker/ring.js";

  // The poker arena: seats around the ellipse (mine bottom centre, big cards),
  // community board + pot in the middle, chips flying seat→pot and pot→winner.
  //  view / me / privates / onSit as before; `pick` = { selected:Set, legal, onSelect, labelOf }
  //  applied to MY hand when the turn asks me to choose cards (draw discards).
  let { view = null, me = null, privates = null, onSit = () => {}, pick = null } = $props();

  let maxSeats = $derived(view?.config?.maxSeats ?? 0);
  let seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded.
  const cardW = $derived(seatNos.length <= 6 ? 82 : seatNos.length <= 8 ? 70 : 60);
  let seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  let mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  let revealedByNo = $derived(new Map((view?.result?.revealed || []).map((r) => [r.seat, r.holeCards])));
  let winnerSet = $derived(new Set((view?.result?.winners || []).map((w) => w.seat)));
  let wonByNo = $derived.by(() => { const m = new Map(); for (const w of view?.result?.winners || []) m.set(w.seat, (m.get(w.seat) || 0) + (w.amount || 0)); return m; });
  let iAmSeated = $derived(mySeatNo != null);

  // Face-down card count for an opponent, by variant.
  const HOLE = { holdem: 2, "holdem-pl": 2, shortdeck: 2, "shortdeck-pl": 2, plo: 4, plo5: 5, "omaha-hilo": 4, "five-card-draw": 5, "seven-card-stud": 3 };
  let holeCount = $derived(HOLE[view?.config?.variant] ?? 2);

  function cardsFor(seatNo, s) {
    if (revealedByNo.has(seatNo)) return revealedByNo.get(seatNo);
    if (mySeatNo === seatNo && privates && privates.seat === seatNo) return privates.holeCards || null;
    if (s?.upCards?.length) return s.upCards;       // Stud: opponents' up-cards are public
    return null;
  }

  // ---- chip flights (bets → pot, pot → winners), purely cosmetic ----
  let flights = $state([]);
  let _fid = 0, _prevCommitted = new Map(), _prevResultKey = null, _seeded = false;
  const POT = { x: 50, y: 50 };
  let positions = $derived(ringPositions(seatNos, mySeatNo, false));
  function spawn(x0, y0, x1, y1, value, kind, delay = 0) {
    if (reducedMotion()) return;
    const id = ++_fid, jx = (Math.random() - 0.5) * 3, jy = (Math.random() - 0.5) * 3;
    flights.push({ id, kind, value, pos: { x: x0 + jx, y: y0 + jy }, o: 0 });
    const f = flights[flights.length - 1];
    requestAnimationFrame(() => requestAnimationFrame(() => { f.pos.x = x1 + jx; f.pos.y = y1 + jy; f.o = 1; }));
    setTimeout(() => { f.o = 0; }, 520 + delay);
    setTimeout(() => { flights = flights.filter((g) => g.id !== id); }, 720 + delay);
  }
  $effect(() => {
    const seats = view?.seats || [];
    const posByNo = new Map(positions.map((p) => [p.seatNo, p]));
    if (!_seeded) { for (const s of seats) _prevCommitted.set(s.seat, s.committed || 0); _prevResultKey = view?.result ? JSON.stringify(view.result.winners || []) : null; _seeded = true; return; }
    for (const s of seats) {
      const prev = _prevCommitted.get(s.seat) || 0, cur = s.committed || 0;
      if (cur > prev) { const p = posByNo.get(s.seat); if (p) spawn(p.x, p.y - 4, POT.x, POT.y, cur - prev, "bet"); }
      _prevCommitted.set(s.seat, cur);
    }
    const rk = view?.result?.winners ? JSON.stringify(view.result.winners) : null;
    if (rk && rk !== _prevResultKey) {
      let i = 0;
      for (const w of view.result.winners) { const p = posByNo.get(w.seat); if (p) { spawn(POT.x, POT.y, p.x, p.y - 4, w.amount, "rake", i * 90); spawn(POT.x, POT.y, p.x, p.y - 4, w.amount, "rake", i * 90 + 120); } i++; }
    }
    _prevResultKey = rk;
  });
</script>

<div class="poker">
  <SeatRing {seatNos} {mySeatNo}>
    {#snippet center()}
      {#if view}
        <CommunityBoard board={view.board || []} potTotal={view.potTotal || 0} street={view.street} result={view.result} width={cardW} />
      {:else}
        <p class="muted">Loading table…</p>
      {/if}
    {/snippet}
    {#snippet seat(seatNo)}
      {@const s = seatByNo.get(seatNo) ?? null}
      {@const mine = !!s && s.userId === me?.id}
      {@const cards = s ? cardsFor(seatNo, s) : null}
      <SeatBadge cardWidth={cardW}
        seat={s} {seatNo} {me} isMine={mine}
        cards={cards}
        cardCount={s && !cards && s.hasCards ? holeCount : 0}
        canSit={!!me && !iAmSeated && (!s || s.userId == null)}
        deadline={s?.isToAct ? view?.actionDeadline ?? null : null}
        winner={winnerSet.has(seatNo)} won={wonByNo.get(seatNo) ?? 0}
        selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
        {onSit}
      />
    {/snippet}
  </SeatRing>

  <div class="fx" aria-hidden="true">
    {#each flights as f (f.id)}
      <span class="flight {f.kind}" style="left:{f.pos.x}%; top:{f.pos.y}%; opacity:{f.o};"><Chip value={f.value} size={f.kind === "rake" ? 26 : 22} /></span>
    {/each}
  </div>
</div>

<style>
  .poker { position: relative; width: 100%; height: 100%; }
  .fx { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
  .flight {
    position: absolute; transform: translate(-50%, -50%); line-height: 0;
    transition: left 0.55s cubic-bezier(0.32, 0.72, 0.24, 1), top 0.55s cubic-bezier(0.32, 0.72, 0.24, 1), opacity 0.2s ease;
    will-change: left, top, opacity; filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
  }
  .flight.rake { transition-duration: 0.5s, 0.5s, 0.2s; }
  @media (prefers-reduced-motion: reduce) { .flight { transition: none; } }
</style>
