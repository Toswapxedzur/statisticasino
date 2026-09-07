<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";

  // Pai Gow: the House's back (5) + front (2) at the top; each player's seven cards
  // fanned under their badge while setting (mine tappable to choose the FRONT two
  // via `pick`), then the set split shown as back + front.
  let { view, me, onSit = () => {}, pick = null } = $props();

  const round = $derived(view?.round || {});
  const dealer = $derived(round.dealer || null);
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded.
  const cardW = $derived(seatNos.length <= 6 ? 82 : seatNos.length <= 8 ? 70 : 60);
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const iAmSeated = $derived(mySeatNo != null);
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
  function lineFor(seatNo, hand) {
    const oc = outcomeOf(seatNo);
    if (oc) return { text: oc.outcome + (oc.delta > 0 ? " +" + fmt(oc.delta) : oc.delta < 0 ? " " + fmt(oc.delta) : ""), kind: oc.delta > 0 ? "win" : oc.delta < 0 ? "lose" : "push" };
    if (hand?.ante) return { text: "ante " + fmt(hand.ante), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

{#snippet split(back, front, w)}
  <div class="split">
    <div class="part"><span class="slabel">back</span><HandFan cards={back} width={w} fan="stack" /></div>
    <div class="part"><span class="slabel">front</span><HandFan cards={front} width={w} fan="row" /></div>
  </div>
{/snippet}

<SeatRing {seatNos} {mySeatNo} houseSeat={bankerSeat}>
  {#snippet top()}
    <SeatBadge cardWidth={cardW} seat={banker ? { ...banker, name: "House" } : { userId: "house", name: "House", stack: 0, connected: true }} house line={dealer && (dealer.hidden || !dealer.back?.length) ? "setting…" : ""} lineKind="muted">
      {#if dealer && !dealer.hidden && dealer.back?.length}{@render split(dealer.back, dealer.front, cardW)}{/if}
    </SeatBadge>
  {/snippet}
  {#snippet center()}{/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const hand = handBySeat.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const set = !!(hand && hand.back && hand.back.length)}
    {@const ln = s ? lineFor(seatNo, hand) : null}
    <SeatBadge cardWidth={cardW}
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={!set && hand?.cards?.length ? hand.cards : null}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={!!outcomeOf(seatNo) && outcomeOf(seatNo).delta > 0}
      selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
      {onSit}
    >
      {#if set}{@render split(hand.back, hand.front, mine ? cardW : Math.round(cardW * 0.7))}{/if}
    </SeatBadge>
  {/snippet}
</SeatRing>

<style>
  .split { display: flex; gap: 14px; align-items: flex-end; }
  .part { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .slabel { font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
</style>
