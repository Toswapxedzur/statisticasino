<script>
  import Seat from "./Seat.svelte";
  import CommunityBoard from "./CommunityBoard.svelte";

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
</script>

<div class="felt-shell">
  <div class="felt">
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
          {onSit}
        />
      </div>
    {/each}

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
</style>
