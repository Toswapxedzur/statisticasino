<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";
  import { getContext } from "svelte";

  // Big Two: the pile / last play in the middle,
  // opponents' hands as fanned backs with a count, my whole hand fanned big under
  // my badge (tappable via `pick`). No dealer, no board.
  let { view, me, hand = [], onSit = () => {}, pick = null } = $props();

  const bankCtx = getContext("bank");
  let bank = $derived(bankCtx?.current ?? null);
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
  // the stage keeps every seat's hand space from the start: the card height (60:78)
  const handSpace = $derived(Math.round((cardW * 78) / 60));
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
      {#if bank}
        <!-- the antes' pot: coins above, the pill below (drawn by MoneyLayer) -->
        <div class="potcoins" data-pot-coins></div>
        <div class="potpill"><span class="lbl">Pot</span> <b data-pot-number>{(bank.pot ?? 0).toLocaleString()}</b></div>
      {/if}
    </div>
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = seatByNo.get(seatNo) ?? null}
    {@const pl = playerByNo.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, pl) : null}
    <SeatBadge cardWidth={cardW} handSpace={handSpace}
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
  .potcoins { width: 120px; height: 34px; margin-bottom: -8px; }
  .potpill { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 13px; background: var(--surface); border-radius: var(--r-pill); box-shadow: var(--shadow-card); font-variant-numeric: tabular-nums; }
  .potpill .lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
  .potpill b { font-size: 15px; font-weight: 800; color: var(--gold-ink); }
  .red { color: var(--card-red); }
  .waiting { font-size: 15px; }
</style>
