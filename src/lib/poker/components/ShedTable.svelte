<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";

  // Shedding games (Crazy Eights, Big Two): the pile / last play in the middle,
  // opponents' hands as fanned backs with a count, my whole hand fanned big under
  // my badge (tappable via `pick`). No dealer, no board.
  let { view, me, hand = [], onSit = () => {}, pick = null } = $props();

  const round = $derived(view?.round || {});
  const maxSeats = $derived(view?.config?.maxSeats ?? 4);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const playerByNo = $derived(new Map((round.players || []).map((p) => [p.seat, p])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const results = $derived(round.results || null);
  const winner = $derived(round.winner ?? null);
  const seatNos = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded.
  const cardW = $derived(seatNos.length <= 6 ? 82 : seatNos.length <= 8 ? 70 : 60);
  const iAmSeated = $derived(mySeatNo != null);
  const pileCards = $derived(round.pile && round.pile.length ? round.pile : (round.top ? [round.top] : []));
  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
  function lineFor(seatNo, pl) {
    const oc = outcomeOf(seatNo);
    if (oc) return { text: (oc.outcome === "win" ? "🏆 " : "") + (oc.delta > 0 ? "+" + fmt(oc.delta) : fmt(oc.delta)), kind: oc.delta > 0 ? "win" : oc.delta < 0 ? "lose" : "push" };
    if (pl) return { text: pl.cardCount + (pl.cardCount === 1 ? " card" : " cards"), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

<SeatRing {seatNos} {mySeatNo}>
  {#snippet center()}
    <div class="pile">
      {#if pileCards.length}
        <HandFan cards={pileCards.slice(-5)} width={cardW} fan="row" />
        <div class="pilenote">
          {#if round.currentSuit}suit <span class:red={isRed(round.currentSuit)}>{SUIT[round.currentSuit]}</span>{/if}
          {#if round.drawCount != null}{round.currentSuit ? " · " : ""}{round.drawCount} in stock{/if}
        </div>
      {:else}<span class="muted waiting">Dealing…</span>{/if}
    </div>
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const pl = playerByNo.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, pl) : null}
    <SeatBadge cardWidth={cardW}
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={mine && hand.length ? hand : null}
      cardCount={!mine && pl ? Math.min(pl.cardCount, 13) : 0}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={winner === seatNo}
      selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .pile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .pilenote { font-size: 12px; color: var(--muted); }
  .red { color: var(--card-red); }
  .waiting { font-size: 15px; }
</style>
