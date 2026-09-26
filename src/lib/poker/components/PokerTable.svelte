<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import CommunityBoard from "./CommunityBoard.svelte";
  import { tableSeats } from "$lib/poker/table-seats.js";

  // The Hold'em arena: seats around the ring (mine bottom centre), the community board + pot in the
  // middle. The coins move on the MoneyLayer and the cards on the DeckLayer (the page draws those).
  //  dealer = the table's Dealer: cards arrive from the deck on its canvas, so the DOM hands / board
  //  stay hidden until they land, and my cards flip after landing.
  let { view = null, me = null, privates = null, onSit = () => {}, dealer = null } = $props();

  const t = $derived(tableSeats(view, me, 0));
  const HOLE_CARDS = 2;
  let revealedByNo = $derived(new Map((view?.result?.revealed || []).map((r) => [r.seat, r.holeCards])));
  let winnerSet = $derived(new Set((view?.result?.winners || []).map((w) => w.seat)));
  let wonByNo = $derived.by(() => { const m = new Map(); for (const w of view?.result?.winners || []) m.set(w.seat, (m.get(w.seat) || 0) + (w.amount || 0)); return m; });

  // The face-up cards a seat shows: revealed at showdown, or my own.
  function cardsFor(seatNo) {
    if (revealedByNo.has(seatNo)) return revealedByNo.get(seatNo);
    if (t.mySeatNo === seatNo && privates && privates.seat === seatNo) return privates.holeCards || null;
    return null;
  }
</script>

<div class="poker">
  <SeatRing seatNos={t.seatNos} mySeatNo={t.mySeatNo}>
    {#snippet center()}
      {#if view}
        <CommunityBoard board={view.board || []} potTotal={view.potTotal || 0} street={view.street} result={view.result} width={t.cardW}
          dealt={dealer ? { shown: dealer.boardShown, faceUp: dealer.boardFaceUp, hidden: dealer.tableHidden } : null} />
      {:else}
        <p class="muted">Loading table…</p>
      {/if}
    {/snippet}
    {#snippet seat(seatNo)}
      {@const s = t.seatByNo.get(seatNo) ?? null}
      {@const mine = !!s && s.userId === me?.id}
      {@const cards = s ? cardsFor(seatNo) : null}
      <SeatBadge cardWidth={t.cardW} handSpace={t.handSpace}
        seat={s} {seatNo} {me} isMine={mine}
        cards={cards}
        cardCount={s && !cards && s.hasCards ? HOLE_CARDS : 0}
        hideCards={dealer ? dealer.seatHidden(seatNo) : false}
        reveal={mine && dealer ? dealer.ownRevealed : true}
        canSit={!!me && !t.iAmSeated && (!s || s.userId == null)}
        deadline={s?.isToAct ? view?.actionDeadline ?? null : null}
        winner={winnerSet.has(seatNo)} won={wonByNo.get(seatNo) ?? 0}
        {onSit}
      />
    {/snippet}
  </SeatRing>
</div>

<style>
  .poker { position: relative; width: 100%; height: 100%; }
</style>
