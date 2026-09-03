<script>
  import Seat from "./Seat.svelte";
  import CommunityBoard from "./CommunityBoard.svelte";
  import Chip from "./Chip.svelte";
  import { reducedMotion } from "$lib/motion.js";

  // The felt. Lays out config.maxSeats seats around an ellipse, rotated so the
  // signed-in user's seat sits bottom-center, with the community board centered.
  //  view      — the public TableView (poker.tables[id]).
  //  me        — poker.me ({id,name,...}) | null.
  //  privates  — poker.privates[id] ({ seat, holeCards }) | undefined.
  //  onSit     — onSit(seatNo) for taking an empty seat.
  let { view = null, me = null, privates = null, onSit = () => {} } = $props();

  let maxSeats = $derived(view?.config?.maxSeats ?? 0);

  // seat number -> seat view object.
  let seatByNo = $derived.by(() => {
    const m = new Map();
    for (const s of view?.seats || []) m.set(s.seat, s);
    return m;
  });

  // The signed-in user's own seat number (null when not seated).
  let mySeatNo = $derived.by(() => {
    if (!me) return null;
    for (const s of view?.seats || []) if (s.userId === me.id) return s.seat;
    return null;
  });

  // Showdown reveals: seat number -> holeCards.
  let revealedByNo = $derived.by(() => {
    const m = new Map();
    for (const r of view?.result?.revealed || []) m.set(r.seat, r.holeCards);
    return m;
  });

  let winnerSet = $derived(new Set((view?.result?.winners || []).map((w) => w.seat)));
  // seat number -> chips won (for the floating "+N" on a winning seat).
  let wonByNo = $derived.by(() => {
    const m = new Map();
    for (const w of view?.result?.winners || []) m.set(w.seat, (m.get(w.seat) || 0) + (w.amount || 0));
    return m;
  });

  // Positions rotated so my seat (or seat 0 when unseated) is bottom-center.
  let positions = $derived.by(() => {
    const n = maxSeats;
    if (!n) return [];
    const anchor = mySeatNo ?? 0;
    const a = 44; // horizontal radius (% of felt)
    const b = 40; // vertical radius (% of felt)
    const out = [];
    for (let seatNo = 0; seatNo < n; seatNo++) {
      const d = ((seatNo - anchor + n) % n); // display slot, 0 = bottom-center
      const theta = Math.PI / 2 + (d / n) * 2 * Math.PI;
      out.push({
        seatNo,
        x: 50 + a * Math.cos(theta),
        y: 50 + b * Math.sin(theta),
      });
    }
    return out;
  });

  function holeCardsFor(seatNo, s) {
    if (revealedByNo.has(seatNo)) return revealedByNo.get(seatNo);
    if (mySeatNo === seatNo && privates && privates.seat === seatNo) {
      return privates.holeCards || null;
    }
    // Seven-Card Stud: opponents' up-cards are public (shown face-up).
    if (s && s.upCards && s.upCards.length) return s.upCards;
    return null;
  }

  let iAmSeated = $derived(mySeatNo != null);

  // ---- chip flight: bets fly seat→pot, the pot rakes to the winner(s) ----
  // Transient chips animated over the felt, driven by state DIFFS: a seat's
  // `committed` rising spawns a bet-chip toward the pot; a fresh result spawns
  // rake chips from the pot to each winner. Purely cosmetic — never blocks play.
  let flights = $state([]);
  let _fid = 0;
  let _prevCommitted = new Map();
  let _prevResultKey = null;
  let _seededDiff = false; // don't fire flights for the state we mount ON

  const POT = { x: 50, y: 50 };

  function spawn(x0, y0, x1, y1, value, kind, delay = 0) {
    if (reducedMotion()) return;
    const id = ++_fid;
    // slight fan so stacked chips don't perfectly overlap
    const jx = (Math.random() - 0.5) * 3, jy = (Math.random() - 0.5) * 3;
    flights.push({ id, kind, value, pos: { x: x0 + jx, y: y0 + jy }, o: 0 });
    const f = flights[flights.length - 1];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      f.pos.x = x1 + jx; f.pos.y = y1 + jy; f.o = 1;
    }));
    setTimeout(() => { f.o = 0; }, 520 + delay);
    setTimeout(() => { flights = flights.filter((g) => g.id !== id); }, 720 + delay);
  }

  $effect(() => {
    const seats = view?.seats || [];
    const posByNo = new Map(positions.map((p) => [p.seatNo, p]));
    // On the first pass just seed the baseline so a mid-hand mount doesn't erupt.
    if (!_seededDiff) {
      for (const s of seats) _prevCommitted.set(s.seat, s.committed || 0);
      _prevResultKey = view?.result ? JSON.stringify(view.result.winners || []) : null;
      _seededDiff = true;
      return;
    }
    for (const s of seats) {
      const prev = _prevCommitted.get(s.seat) || 0;
      const cur = s.committed || 0;
      if (cur > prev) {
        const p = posByNo.get(s.seat);
        if (p) spawn(p.x, p.y - 4, POT.x, POT.y, cur - prev, "bet");
      }
      _prevCommitted.set(s.seat, cur);
    }
    const rk = view?.result?.winners ? JSON.stringify(view.result.winners) : null;
    if (rk && rk !== _prevResultKey) {
      let i = 0;
      for (const w of view.result.winners) {
        const p = posByNo.get(w.seat);
        if (p) { spawn(POT.x, POT.y, p.x, p.y - 4, w.amount, "rake", i * 90); spawn(POT.x, POT.y, p.x, p.y - 4, w.amount, "rake", i * 90 + 120); }
        i++;
      }
    }
    _prevResultKey = rk;
  });
</script>

<div class="felt-shell">
  <div class="felt">
    <!-- ambient depth: a soft glow pools under the board so the floating seats
         sit in a lit space (no green felt — just light + shadow). -->
    <div class="ambient" aria-hidden="true"></div>

    <div class="center">
      {#if view}
        <CommunityBoard
          board={view.board || []}
          potTotal={view.potTotal || 0}
          street={view.street}
          result={view.result}
        />
      {/if}
    </div>

    {#each positions as p (p.seatNo)}
      {@const s = seatByNo.get(p.seatNo) ?? null}
      <div class="slot" style="left:{p.x}%; top:{p.y}%;">
        <Seat
          seat={s ? { ...s, holeCards: holeCardsFor(p.seatNo, s) } : null}
          seatNo={p.seatNo}
          {me}
          isMine={s ? s.userId === me?.id : false}
          canSit={!!me && !iAmSeated && (!s || s.userId == null)}
          deadline={s?.isToAct ? view?.actionDeadline ?? null : null}
          winner={winnerSet.has(p.seatNo)}
          won={wonByNo.get(p.seatNo) ?? 0}
          {onSit}
        />
      </div>
    {/each}

    <!-- flying chips (bets → pot, pot → winner). Above seats, ignores input. -->
    <div class="fx" aria-hidden="true">
      {#each flights as f (f.id)}
        <span class="flight {f.kind}" style="left:{f.pos.x}%; top:{f.pos.y}%; opacity:{f.o};">
          <Chip value={f.value} size={f.kind === "rake" ? 26 : 22} />
        </span>
      {/each}
    </div>

    {#if !view}
      <div class="center placeholder">
        <p class="muted">Loading table…</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .felt-shell { display: flex; justify-content: center; padding: 18px 0 34px; }
  /* No green felt — the play area rides the app ground; seats + board float on
     it, held apart by their own elevation. */
  .felt {
    width: min(820px, 96vw);
    aspect-ratio: 16 / 9;
    position: relative;
  }

  @media (max-width: 640px) {
    .felt { aspect-ratio: 4 / 5; width: 96vw; }
  }

  .center {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #dfeee6;
  }

  .slot {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 2;
  }

  .placeholder { z-index: 1; }

  /* soft light pooled under the board — depth without a felt */
  .ambient {
    position: absolute;
    inset: 6% 10%;
    z-index: 0;
    pointer-events: none;
    border-radius: 50%;
    background:
      radial-gradient(60% 60% at 50% 46%, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%),
      radial-gradient(42% 42% at 50% 50%, color-mix(in srgb, var(--gold) 10%, transparent) 0%, transparent 65%);
    filter: blur(6px);
  }

  /* flying-chip layer */
  .fx { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  .flight {
    position: absolute;
    transform: translate(-50%, -50%);
    line-height: 0;
    transition:
      left 0.55s cubic-bezier(0.32, 0.72, 0.24, 1),
      top 0.55s cubic-bezier(0.32, 0.72, 0.24, 1),
      opacity 0.2s ease;
    will-change: left, top, opacity;
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
  }
  .flight.rake { transition-duration: 0.5s, 0.5s, 0.2s; }

  @media (prefers-reduced-motion: reduce) {
    .flight { transition: none; }
  }
</style>
