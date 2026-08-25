<script>
  // Pai Gow felt: the dealer's back (5) + front (2), and each seat's split (or the
  // seven cards while still setting), plus win/push/lose per seat.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const dealer = $derived(round.dealer || null);
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const playerSeats = $derived(Array.from({ length: maxSeats }, (_, i) => i).filter((i) => i !== bankerSeat));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
</script>

{#snippet cardrow(cards)}
  <div class="cards">
    {#each cards as c}<span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>{/each}
  </div>
{/snippet}

<section class="felt-shell">
  <div class="felt">
    <div class="house">
      <div class="house-label">House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}</div>
      {#if dealer && !dealer.hidden && dealer.back.length}
        <div class="split"><span class="slabel">back</span>{@render cardrow(dealer.back)}<span class="slabel">front</span>{@render cardrow(dealer.front)}</div>
      {:else}<div class="muted waiting">setting…</div>{/if}
    </div>

    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const hand = handBySeat.get(seatNo)}
        {@const oc = outcomeOf(seatNo)}
        <div class="seat" class:toact={round.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            {#if hand && hand.back && hand.back.length}
              <div class="split small"><span class="slabel">back</span>{@render cardrow(hand.back)}<span class="slabel">front</span>{@render cardrow(hand.front)}</div>
            {:else if hand && hand.cards && hand.cards.length}
              <div class="small">{@render cardrow(hand.cards)}</div>
            {:else}<span class="muted small">—</span>{/if}
            {#if oc}<div class="outc {oc.outcome}">{oc.outcome}{oc.delta > 0 ? " +" + oc.delta : oc.delta < 0 ? " " + oc.delta : ""}</div>{/if}
          {:else}
            <button class="btn btn-secondary btn-sm sit" onclick={() => onSit(seatNo)}>Sit</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .felt-shell { display: flex; justify-content: center; padding: 10px 0 20px; }
  .felt {
    width: min(900px, 96vw); min-height: 300px; padding: 22px; border-radius: var(--r-panel);
    display: flex; flex-direction: column; gap: 16px; color: var(--text);
  }
  .house { text-align: center; }
  .house-label { font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; margin-bottom: 6px; }
  .bankroll { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .split { display: flex; align-items: center; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .slabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; }
  .cards { display: inline-flex; gap: 4px; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 5px; padding: 5px 6px; font-weight: 700; font-size: 13px; line-height: 1; box-shadow: var(--shadow-card); margin-bottom: 0;
  }
  .small .card { font-size: 12px; padding: 4px 5px; }
  .card.red { color: var(--card-red); }
  .suit { font-size: 0.9em; }
  .waiting { font-size: 13px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .seat {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    padding: 10px; min-height: 92px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .seat.toact { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); transform: translateY(-1px); }
  .seat.mine { background: var(--surface-2); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .outc { font-size: 12px; font-weight: 700; text-transform: capitalize; }
  .outc.win { color: var(--ok); }
  .outc.lose { color: var(--danger); }
  .outc.push { color: var(--gold-ink); }
  .small { font-size: 11.5px; }
</style>
