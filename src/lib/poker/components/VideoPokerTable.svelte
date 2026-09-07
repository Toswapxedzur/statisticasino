<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";

  // Hold-and-draw games (Video Poker): everyone's five cards fanned under their
  // badge (mine big and tappable to HOLD via `pick`), paytable in the middle.
  let { view, me, onSit = () => {}, pick = null } = $props();

  const round = $derived(view?.round || {});
  const paytable = $derived(round.paytable || []);
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const iAmSeated = $derived(mySeatNo != null);
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
  function lineFor(seatNo, hand) {
    const oc = outcomeOf(seatNo);
    if (oc) return { text: (oc.hand ? oc.hand + " " : "") + (oc.delta > 0 ? "+" + fmt(oc.delta) : fmt(oc.delta)), kind: oc.delta > 0 ? "win" : oc.delta < 0 ? "lose" : "push" };
    if (hand?.bet) return { text: "bet " + fmt(hand.bet), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

<SeatRing {seatNos} {mySeatNo} houseSeat={bankerSeat}>
  {#snippet top()}
    <SeatBadge seat={banker ? { ...banker, name: "House" } : { userId: "house", name: "House", stack: 0, connected: true }} house line="" />
  {/snippet}
  {#snippet center()}
    {#if paytable.length}
      <div class="paytable">
        {#each paytable as row}<div class="prow"><span class="pn">{row.name}</span><span class="pp">{row.pays}:1</span></div>{/each}
      </div>
    {/if}
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const hand = handBySeat.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, hand) : null}
    <SeatBadge
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={hand?.cards?.length ? hand.cards : null}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={!!outcomeOf(seatNo) && outcomeOf(seatNo).delta > 0}
      selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .paytable { display: grid; grid-template-columns: auto auto; gap: 2px 14px; font-size: 12px; padding: 10px 14px; background: color-mix(in srgb, var(--surface) 80%, transparent); border-radius: var(--r-card); box-shadow: var(--shadow-card); }
  .prow { display: contents; }
  .pn { color: var(--muted); text-align: left; }
  .pp { font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
</style>
