<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import CommunityBoard from "./CommunityBoard.svelte";

  // The Hold'em arena: seats around the ring (mine bottom centre), the community board + pot in the
  // middle. The coins move on the MoneyLayer and the cards on the DeckLayer (the page draws those).
  //  dealer = the table's Dealer: cards arrive from the deck on its canvas, so the DOM hands / board
  //  stay hidden until they land, and my cards flip after landing.
  let { view = null, me = null, privates = null, onSit = () => {}, dealer = null } = $props();

  let maxSeats = $derived(view?.config?.maxSeats ?? 0);
  let seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded.
  const cardW = $derived(seatNos.length <= 6 ? 82 : seatNos.length <= 8 ? 70 : 60);
  // the stage keeps every seat's hand space from the start: the card height (60:78)
  const handSpace = $derived(Math.round((cardW * 78) / 60));
  const HOLE_CARDS = 2;
  let seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  let mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  let revealedByNo = $derived(new Map((view?.result?.revealed || []).map((r) => [r.seat, r.holeCards])));
  let winnerSet = $derived(new Set((view?.result?.winners || []).map((w) => w.seat)));
  let wonByNo = $derived.by(() => { const m = new Map(); for (const w of view?.result?.winners || []) m.set(w.seat, (m.get(w.seat) || 0) + (w.amount || 0)); return m; });
  let iAmSeated = $derived(mySeatNo != null);

  // The face-up cards a seat shows: revealed at showdown, or my own.
  function cardsFor(seatNo) {
    if (revealedByNo.has(seatNo)) return revealedByNo.get(seatNo);
    if (mySeatNo === seatNo && privates && privates.seat === seatNo) return privates.holeCards || null;
    return null;
  }
</script>

<div class="poker">
  <SeatRing {seatNos} {mySeatNo}>
    {#snippet center()}
      {#if view}
        <CommunityBoard board={view.board || []} potTotal={view.potTotal || 0} street={view.street} result={view.result} width={cardW}
          dealt={dealer ? { shown: dealer.boardShown, faceUp: dealer.boardFaceUp, hidden: dealer.tableHidden } : null} />
      {:else}
        <p class="muted">Loading table…</p>
      {/if}
    {/snippet}
    {#snippet seat(seatNo)}
      {@const s = seatByNo.get(seatNo) ?? null}
      {@const mine = !!s && s.userId === me?.id}
      {@const cards = s ? cardsFor(seatNo) : null}
      <SeatBadge cardWidth={cardW} handSpace={handSpace}
        seat={s} {seatNo} {me} isMine={mine}
        cards={cards}
        cardCount={s && !cards && s.hasCards ? HOLE_CARDS : 0}
        hideCards={dealer ? dealer.seatHidden(seatNo) : false}
        reveal={mine && dealer ? dealer.ownRevealed : true}
        canSit={!!me && !iAmSeated && (!s || s.userId == null)}
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
