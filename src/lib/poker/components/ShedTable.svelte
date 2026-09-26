<script>
  import SeatRing from "./SeatRing.svelte";
  import SeatBadge from "./SeatBadge.svelte";
  import HandFan from "./HandFan.svelte";
  import { getContext } from "svelte";
  import { tableSeats, outcomeOf, signed, deltaKind } from "$lib/poker/table-seats.js";

  // Big Two: the pile / last play in the middle,
  // opponents' hands as fanned backs with a count, my whole hand fanned big under
  // my badge (tappable via `pick`). No dealer, no board.
  let { view, me, hand = [], onSit = () => {}, pick = null } = $props();

  const bankCtx = getContext("bank");
  let bank = $derived(bankCtx?.current ?? null);
  const round = $derived(view?.round || {});
  const t = $derived(tableSeats(view, me, 4));
  const playerByNo = $derived(new Map((round.players || []).map((p) => [p.seat, p])));
  const results = $derived(round.results || null);
  const winner = $derived(round.winner ?? null);
  function lineFor(seatNo, pl) {
    const oc = outcomeOf(results, seatNo);
    if (oc) return { text: (oc.outcome === "win" ? "🏆 " : "") + signed(oc.delta), kind: deltaKind(oc.delta) };
    if (pl) return { text: pl.cardCount + (pl.cardCount === 1 ? " card" : " cards"), kind: "" };
    return { text: "", kind: "muted" };
  }
</script>

<SeatRing seatNos={t.seatNos} mySeatNo={t.mySeatNo}>
  {#snippet center()}
    <div class="pile">
      {#if round.pile?.length}
        <HandFan cards={round.pile} width={t.cardW} fan="row" />
      {:else}<span class="muted waiting">Dealing…</span>{/if}
      {#if bank}
        <!-- the antes' pot: coins above, the pill below (drawn by MoneyLayer) -->
        <div class="potcoins" data-pot-coins></div>
        <div class="potpill"><span class="lbl">Pot</span> <b data-pot-number>{(bank.pot ?? 0).toLocaleString()}</b></div>
      {/if}
    </div>
  {/snippet}
  {#snippet seat(seatNo)}
    {@const s = t.seatByNo.get(seatNo) ?? null}
    {@const pl = playerByNo.get(seatNo)}
    {@const mine = !!s && s.userId === me?.id}
    {@const ln = s ? lineFor(seatNo, pl) : null}
    <SeatBadge cardWidth={t.cardW} handSpace={t.handSpace}
      seat={s ? { ...s, isToAct: round.toActSeat === seatNo } : null} {seatNo} {me} isMine={mine}
      cards={mine && hand.length ? hand : null}
      cardCount={!mine && pl ? Math.min(pl.cardCount, 13) : 0}
      line={ln?.text ?? ""} lineKind={ln?.kind ?? "muted"}
      canSit={!!me && !t.iAmSeated && !s}
      deadline={round.toActSeat === seatNo ? view?.actionDeadline ?? null : null}
      winner={winner === seatNo}
      selectable={mine ? pick : null} onSelect={pick?.onSelect} labelOf={pick?.labelOf}
      {onSit}
    />
  {/snippet}
</SeatRing>

<style>
  .pile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .potcoins { width: 120px; height: 34px; margin-bottom: -8px; }
  .potpill { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 13px; background: var(--surface); border-radius: var(--r-pill); box-shadow: var(--shadow-card); font-variant-numeric: tabular-nums; }
  .potpill .lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); }
  .potpill b { font-size: 15px; font-weight: 800; color: var(--gold-ink); }
  .waiting { font-size: 15px; }
</style>
