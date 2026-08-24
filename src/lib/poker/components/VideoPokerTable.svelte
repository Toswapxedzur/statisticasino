<script>
  // Felt for hold-and-draw games (Video Poker). No dealer/community — each seat has
  // its own five-card hand, plus a paytable reference. The interactive hold/draw
  // lives in VideoPokerBar; this just renders hands + outcomes.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const paytable = $derived(round.paytable || []);
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

<section class="felt-shell">
  <div class="felt">
    <div class="house">House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}</div>

    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const hand = handBySeat.get(seatNo)}
        {@const oc = outcomeOf(seatNo)}
        <div class="seat" class:toact={round.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            <div class="cards">
              {#if hand && hand.cards.length}
                {#each hand.cards as c}
                  <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
                {/each}
              {:else}<span class="muted small">—</span>{/if}
            </div>
            {#if oc}<div class="outc {oc.outcome}">{oc.hand ? oc.hand + " " : ""}{oc.delta > 0 ? "+" + oc.delta : oc.delta}</div>{/if}
          {:else}
            <button class="btn btn-sm sit" onclick={() => onSit(seatNo)}>Sit</button>
          {/if}
        </div>
      {/each}
    </div>

    {#if paytable.length}
      <div class="paytable">
        {#each paytable as row}<div class="prow"><span class="pn">{row.name}</span><span class="pp">{row.pays}:1</span></div>{/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .felt-shell { display: flex; justify-content: center; padding: 10px 0 20px; }
  .felt {
    width: min(900px, 96vw); min-height: 300px; padding: 22px; border-radius: 24px;
    background: radial-gradient(ellipse at center, #2e7d55 0%, #1f6043 70%, #17402f 100%);
    border: 12px solid #5b3a24; box-shadow: inset 0 0 60px rgba(0,0,0,0.4), 0 20px 40px rgba(0,0,0,0.35);
    display: flex; flex-direction: column; gap: 16px; color: #eafaf1;
  }
  .house { text-align: center; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; }
  .bankroll { opacity: 0.85; font-variant-numeric: tabular-nums; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .seat {
    background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
    padding: 10px; min-height: 92px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
  }
  .seat.toact { border-color: #ffd166; box-shadow: 0 0 0 2px rgba(255,209,102,0.35); }
  .seat.mine { background: rgba(108,207,255,0.12); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .cards { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; min-height: 34px; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: #fbfbfd; color: #1a1a1a;
    border-radius: 5px; padding: 4px 6px; font-weight: 700; font-size: 13px; line-height: 1; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }
  .card.red { color: #c0392b; }
  .suit { font-size: 0.9em; }
  .outc { font-size: 12px; font-weight: 700; }
  .outc.win { color: #7be0a0; }
  .outc.lose { color: #ffb3b8; }
  .paytable {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 2px 18px;
    background: rgba(0,0,0,0.25); border-radius: 10px; padding: 10px 14px; font-size: 12px;
  }
  .prow { display: flex; justify-content: space-between; gap: 10px; }
  .pp { font-variant-numeric: tabular-nums; color: #ffd166; font-weight: 700; }
  .small { font-size: 11.5px; }
  .sit { background: rgba(255,255,255,0.9); color: #143; }
</style>
