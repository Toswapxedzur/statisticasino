<script>
  // Generic table for bet-selection games (baccarat/roulette/sic-bo). Shows the
  // round OUTCOME the game provides (a headline + optional labeled card hands),
  // and each seat's BETS + result. No per-game code.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const outcome = $derived(round.outcome || null);
  const results = $derived(round.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const betsBySeat = $derived(new Map((round.bets || []).map((b) => [b.seat, b.bets])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const playerSeats = $derived(Array.from({ length: maxSeats }, (_, i) => i).filter((i) => i !== bankerSeat));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
</script>

<section class="felt-shell">
  <div class="felt">
    <div class="house">House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}</div>

    <div class="outcome">
      {#if outcome}
        <div class="headline">{outcome.headline}</div>
        {#if outcome.hands}
          <div class="ohands">
            {#each outcome.hands as h}
              <div class="ohand">
                <div class="hl">{h.label}</div>
                <div class="cards">
                  {#each h.cards as c}
                    <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="muted waiting">Place your bets…</div>
      {/if}
    </div>

    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const bets = betsBySeat.get(seatNo)}
        {@const oc = outcomeOf(seatNo)}
        <div class="seat" class:toact={round.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            {#if bets && bets.length}
              <div class="bets">{#each bets as b}<span class="betchip">{b.option} {b.amount.toLocaleString()}</span>{/each}</div>
            {:else}<span class="muted small">—</span>{/if}
            {#if oc && oc.delta !== 0}<div class="outc {oc.outcome}">{oc.delta > 0 ? "+" + oc.delta : oc.delta}</div>{/if}
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
    width: min(900px, 96vw); min-height: 320px; padding: 22px; border-radius: var(--r-panel);
    display: flex; flex-direction: column; gap: 18px; color: var(--text);
  }
  .house { text-align: center; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; }
  .bankroll { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .outcome { text-align: center; min-height: 60px; }
  .headline { font-size: 20px; font-weight: 800; margin-bottom: 8px; }
  .ohands { display: flex; gap: 26px; justify-content: center; flex-wrap: wrap; }
  .ohand .hl { font-size: 12px; opacity: 0.85; margin-bottom: 4px; }
  .cards { display: flex; gap: 6px; justify-content: center; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 6px; padding: 6px 8px; font-weight: 700; font-size: 16px; box-shadow: var(--shadow-card); margin-bottom: 0;
  }
  .card.red { color: var(--card-red); }
  .suit { font-size: 0.9em; }
  .waiting { font-size: 14px; padding-top: 16px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
  .seat {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    padding: 10px; min-height: 80px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .seat.toact { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); transform: translateY(-1px); }
  .seat.mine { background: var(--surface-2); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .bets { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
  .betchip { font-size: 11px; background: var(--gold-bg); color: var(--gold-ink); border-radius: var(--r-pill); padding: 1px 7px; }
  .outc { font-size: 12px; font-weight: 700; }
  .outc.win { color: var(--ok); }
  .outc.lose { color: var(--danger); }
  .small { font-size: 11.5px; }
</style>
