<script>
  // Keno felt: the 20 drawn numbers (once revealed) and each seat's ticket with
  // caught spots highlighted, plus the result. No dealer.

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
  const playerSeats = $derived(Array.from({ length: maxSeats }, (_, i) => i).filter((i) => i !== bankerSeat));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
</script>

<section class="felt-shell">
  <div class="felt">
    <div class="house">House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}</div>

    <div class="drawn">
      {#if drawn.length}
        {#each drawn as n}<span class="dnum">{n}</span>{/each}
      {:else}<span class="muted waiting">Mark your ticket…</span>{/if}
    </div>

    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const t = ticketBySeat.get(seatNo)}
        {@const oc = outcomeOf(seatNo)}
        <div class="seat" class:toact={round.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            {#if t && t.spots.length}
              <div class="ticket">{#each t.spots as n}<span class="spot" class:hit={drawnSet.has(n)}>{n}</span>{/each}</div>
              <div class="muted small">bet {t.amount.toLocaleString()}</div>
            {:else}<span class="muted small">—</span>{/if}
            {#if oc && oc.outcome !== "skip"}
              <div class="outc {oc.outcome}">{oc.catches != null ? oc.catches + " caught · " : ""}{oc.delta > 0 ? "+" + oc.delta : oc.delta}</div>
            {/if}
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
    width: min(900px, 96vw); min-height: 280px; padding: 22px; border-radius: var(--r-panel);
    display: flex; flex-direction: column; gap: 16px; color: var(--text);
  }
  .house { text-align: center; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; }
  .bankroll { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .drawn { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; min-height: 34px; align-items: center; }
  .dnum {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 4px;
    background: var(--gold-bg); color: var(--gold-ink); border-radius: 6px; font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums;
  }
  .waiting { font-size: 13px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .seat {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    padding: 10px; min-height: 90px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .seat.toact { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); transform: translateY(-1px); }
  .seat.mine { background: var(--surface-2); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .ticket { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; }
  .spot {
    display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px;
    background: var(--well); border-radius: 5px; font-size: 11.5px; font-variant-numeric: tabular-nums;
  }
  .spot.hit { background: var(--gold-bg); color: var(--gold-ink); font-weight: 800; }
  .outc { font-size: 12px; font-weight: 700; }
  .outc.win { color: var(--ok); }
  .outc.lose { color: var(--danger); }
  .small { font-size: 11.5px; }
</style>
