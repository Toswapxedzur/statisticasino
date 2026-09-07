<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";
  import { fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Bet-selection games (baccarat, roulette, sic bo, craps, slots, wheel, …): the
  // round outcome (headline + any labelled card hands) sits in the middle, the
  // House on top, each player's bets + result in their badge line.
  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const outcome = $derived(round.outcome || null);
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const betsBySeat = $derived(new Map((round.bets || []).map((b) => [b.seat, b.bets])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded.
  const cardW = $derived(seatNos.length <= 6 ? 82 : seatNos.length <= 8 ? 70 : 60);
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const iAmSeated = $derived(mySeatNo != null);
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
  function lineFor(seatNo) {
    const oc = outcomeOf(seatNo);
    if (oc && oc.delta !== 0) return { text: (oc.delta > 0 ? "+" : "") + fmt(oc.delta), kind: oc.delta > 0 ? "win" : "lose" };
    const bets = betsBySeat.get(seatNo);
    if (bets && bets.length) return { text: bets.map((b) => `${b.option} ${fmt(b.amount)}`).join(" · "), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

<SeatRing {seatNos} {mySeatNo} houseSeat={bankerSeat}>
  {#snippet top()}
    <SeatBadge cardWidth={cardW} seat={banker ? { ...banker, name: "House" } : { userId: "house", name: "House", stack: 0, connected: true }} house line="" />
  {/snippet}
  {#snippet center()}
    <div class="outcome">
      {#if outcome}
        <div class="headline" transition:fade={{ duration: d(DUR.base) }}>{outcome.headline}</div>
        {#if outcome.hands}
          <div class="ohands">
            {#each outcome.hands as h}
              <div class="ohand"><div class="hl">{h.label}</div><HandFan cards={h.cards} width={cardW} fan="row" /></div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="muted waiting">Place your bets…</div>
      {/if}
    </div>
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const ln = s ? lineFor(seatNo) : null}
    <SeatBadge cardWidth={cardW}
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={!!s && s.userId === me?.id}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={!!outcomeOf(seatNo) && outcomeOf(seatNo).delta > 0}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .outcome { text-align: center; min-height: 60px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .headline { font-size: 22px; font-weight: 800; }
  .ohands { display: flex; gap: 28px; justify-content: center; flex-wrap: wrap; }
  .ohand { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ohand .hl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
  .waiting { font-size: 15px; }
</style>
