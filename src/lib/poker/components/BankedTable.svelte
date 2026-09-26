<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";
  import { fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import { tableSeats, outcomeOf, fmt, signed, deltaKind } from "$lib/poker/table-seats.js";

  // Banked card games (Blackjack, Three Card Poker):
  // the House badge + its cards at the top, an optional community row in the
  // middle, every player on the ring with their hand fanned under their badge.
  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || null);
  const dealer = $derived(round?.dealer || null);
  const community = $derived(round?.community || []);
  const results = $derived(round?.results || null);
  const t = $derived(tableSeats(view, me));
  const handBySeat = $derived(new Map((round?.hands || []).map((h) => [h.seat, h])));
  const dealerNote = $derived(dealer
    ? [dealer.value != null ? dealer.value + (dealer.bust ? " bust" : "") : "", dealer.hand || "", dealer.qualified === false ? "no qualify" : ""].filter(Boolean).join(" · ")
    : "");
  // Status line for a player: outcome > wager > hand value.
  function lineFor(seatNo, hand) {
    const oc = outcomeOf(results, seatNo);
    if (oc) return { text: (oc.outcome === "blackjack" ? "Blackjack! " : oc.outcome + " ") + signed(oc.delta), kind: deltaKind(oc.delta) };
    if (!hand) return null;
    const bits = [];
    if (hand.bet) bits.push("bet " + fmt(hand.bet));
    if (hand.ante) bits.push("ante " + fmt(hand.ante) + (hand.call ? " + call " + fmt(hand.call) : ""));
    if (hand.value != null) bits.push(hand.value + (hand.blackjack ? " BJ" : hand.bust ? " bust" : ""));
    if (hand.folded) bits.push("folded");
    return { text: bits.join(" · "), kind: hand.bust ? "lose" : "" };
  }
</script>

<SeatRing seatNos={t.seatNos} mySeatNo={t.mySeatNo} houseSeat={t.bankerSeat}>
  {#snippet top()}
    <div class="house">
      <SeatBadge cardWidth={t.cardW} handSpace={t.handSpace} seat={t.house} house cards={dealer?.cards?.length ? dealer.cards : null} line={dealerNote || (dealer ? "" : "waiting…")} lineKind="muted" />
    </div>
  {/snippet}
  {#snippet center()}
    {#if community.length}
      <div class="community" transition:fade={{ duration: d(DUR.base) }}>
        <div class="lbl">Board</div>
        <HandFan cards={community} width={t.cardW} fan="row" />
      </div>
    {/if}
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = t.seatByNo.get(seatNo) ?? null}
    {@const hand = handBySeat.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, hand) : null}
    <SeatBadge cardWidth={t.cardW} handSpace={t.handSpace}
      seat={s ? { ...s, isToAct: round?.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={hand?.cards?.length ? hand.cards : null}
      line={ln?.text ?? (s?.sittingOut ? "sitting out" : "")} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !t.iAmSeated && !s}
      deadline={round?.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={outcomeOf(results, seatNo)?.delta > 0}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .house { display: flex; justify-content: center; }
  .community { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
</style>
