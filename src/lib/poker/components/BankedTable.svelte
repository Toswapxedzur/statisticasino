<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";
  import { fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Banked card games (blackjack, casino hold'em, three card, stud, red dog, …):
  // the House badge + its cards at the top, an optional community row in the
  // middle, every player on the ring with their hand fanned under their badge.
  let { view, me, onSit = () => {}, pick = null } = $props();

  const round = $derived(view?.round || null);
  const dealer = $derived(round?.dealer || null);
  const community = $derived(round?.community || []);
  const results = $derived(round?.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round?.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const iAmSeated = $derived(mySeatNo != null);
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  const dealerNote = $derived(dealer
    ? [dealer.value != null ? dealer.value + (dealer.bust ? " bust" : "") : "", dealer.hand || "", dealer.qualified === false ? "no qualify" : ""].filter(Boolean).join(" · ")
    : "");
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
  // Status line for a player: outcome > wager > hand value.
  function lineFor(seatNo, hand) {
    const oc = outcomeOf(seatNo);
    if (oc) return { text: (oc.outcome === "blackjack" ? "Blackjack! " : oc.outcome + " ") + (oc.delta > 0 ? "+" + fmt(oc.delta) : fmt(oc.delta)), kind: oc.delta > 0 ? "win" : oc.delta < 0 ? "lose" : "push" };
    if (!hand) return null;
    const bits = [];
    if (hand.bet) bits.push("bet " + fmt(hand.bet));
    if (hand.ante) bits.push("ante " + fmt(hand.ante) + (hand.call ? " + call " + fmt(hand.call) : ""));
    if (hand.value != null) bits.push(hand.value + (hand.blackjack ? " BJ" : hand.bust ? " bust" : ""));
    if (hand.folded) bits.push("folded");
    return { text: bits.join(" · "), kind: hand.bust ? "lose" : "" };
  }
</script>

<SeatRing {seatNos} {mySeatNo} houseSeat={bankerSeat}>
  {#snippet top()}
    <div class="house">
      <SeatBadge seat={banker ? { ...banker, name: "House" } : { userId: "house", name: "House", stack: 0, connected: true }} house cards={dealer?.cards?.length ? dealer.cards : null} line={dealerNote || (dealer ? "" : "waiting…")} lineKind="muted" />
    </div>
  {/snippet}
  {#snippet center()}
    {#if community.length}
      <div class="community" transition:fade={{ duration: d(DUR.base) }}>
        <div class="lbl">Board</div>
        <HandFan cards={community} width={62} fan="row" />
      </div>
    {/if}
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const hand = handBySeat.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, hand) : null}
    <SeatBadge
      seat={s ? { ...s, isToAct: round?.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={hand?.cards?.length ? hand.cards : null}
      line={ln?.text ?? (s?.sittingOut ? "sitting out" : "")} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round?.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={!!outcomeOf(seatNo) && outcomeOf(seatNo).delta > 0}
      selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .house { display: flex; justify-content: center; }
  .community { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
</style>
