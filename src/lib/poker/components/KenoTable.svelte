<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import { scale, fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // Keno: the 20 drawn numbers in the middle, each player's ticket (hits lit) under
  // their badge, result in the badge line.
  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const drawn = $derived(round.drawn || []);
  const drawnSet = $derived(new Set(drawn));
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const ticketBySeat = $derived(new Map((round.tickets || []).map((t) => [t.seat, t])));
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
    if (oc && oc.outcome !== "skip") return { text: (oc.catches != null ? oc.catches + " caught · " : "") + (oc.delta > 0 ? "+" + fmt(oc.delta) : fmt(oc.delta)), kind: oc.delta > 0 ? "win" : oc.delta < 0 ? "lose" : "push" };
    const t = ticketBySeat.get(seatNo);
    if (t && t.spots.length) return { text: "bet " + fmt(t.amount), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

<SeatRing {seatNos} {mySeatNo} houseSeat={bankerSeat}>
  {#snippet top()}
    <SeatBadge cardWidth={cardW} seat={banker ? { ...banker, name: "House" } : { userId: "house", name: "House", stack: 0, connected: true }} house line="" />
  {/snippet}
  {#snippet center()}
    <div class="drawn">
      {#if drawn.length}
        {#each drawn as n, i (n)}<span class="dnum" in:scale={{ start: 0.6, duration: d(DUR.base), delay: d(i * 35) }}>{n}</span>{/each}
      {:else}<span class="muted waiting">Mark your ticket…</span>{/if}
    </div>
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const t = ticketBySeat.get(seatNo)}
    {@const ln = s ? lineFor(seatNo) : null}
    <SeatBadge cardWidth={cardW}
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={!!s && s.userId === me?.id}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={!!outcomeOf(seatNo) && outcomeOf(seatNo).delta > 0}
      {onSit}
    >
      {#if t && t.spots.length}
        <div class="ticket" transition:fade={{ duration: d(DUR.base) }}>{#each t.spots as n}<span class="spot" class:hit={drawnSet.has(n)}>{n}</span>{/each}</div>
      {/if}
    </SeatBadge>
  {/snippet}
</SeatRing>

<style>
  .drawn { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 360px; }
  .dnum { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--surface); box-shadow: var(--shadow-card); font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .waiting { font-size: 15px; }
  .ticket { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; max-width: 190px; }
  .spot { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: var(--well); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .spot.hit { background: var(--gold-bg); color: var(--gold-ink); box-shadow: 0 0 0 1px var(--gold-ink); }
</style>
