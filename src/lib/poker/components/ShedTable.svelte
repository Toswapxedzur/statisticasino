<script>
  // Felt for shedding games (Crazy Eights, Big Two). Center shows the pile / last
  // play + the active suit; each opponent shows a fan of card-backs + their count;
  // your own hand lives in ShedBar. No dealer, no board.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || {});
  const maxSeats = $derived(view?.config?.maxSeats ?? 4);
  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const playerByNo = $derived(new Map((round.players || []).map((p) => [p.seat, p])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const results = $derived(round.results || null);
  const winner = $derived(round.winner ?? null);
  const seatList = $derived(Array.from({ length: maxSeats }, (_, i) => i));
  // Big Two shows a multi-card pile; Crazy Eights a single top card.
  const pileCards = $derived(round.pile && round.pile.length ? round.pile : (round.top ? [round.top] : []));
  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const isRed = (su) => su === "d" || su === "h";
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
</script>

<section class="felt-shell">
  <div class="felt">
    <div class="pile">
      {#if pileCards.length}
        <div class="pilecards">
          {#each pileCards as t}<span class="card big" class:red={isRed(t[1])}>{t[0]}<span class="suit">{SUIT[t[1]]}</span></span>{/each}
        </div>
        <div class="pilenote">
          {#if round.currentSuit}suit <span class:red={isRed(round.currentSuit)}>{SUIT[round.currentSuit]}</span>{/if}
          {#if round.drawCount != null}{round.currentSuit ? " · " : ""}{round.drawCount} in stock{/if}
        </div>
      {:else}<span class="muted waiting">Dealing…</span>{/if}
    </div>

    <div class="seats">
      {#each seatList as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const pl = playerByNo.get(seatNo)}
        {@const oc = outcomeOf(seatNo)}
        <div class="seat" class:toact={round.toActSeat === seatNo} class:mine={seatNo === mySeatNo} class:won={winner === seatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}{#if seatNo === mySeatNo} (you){/if}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            {#if pl}
              {#if seatNo === mySeatNo}
                <div class="count">{pl.cardCount} card{pl.cardCount === 1 ? "" : "s"} in hand ↓</div>
              {:else}
                <div class="backs">
                  {#each Array(Math.min(pl.cardCount, 12)) as _unused}<span class="back">🂠</span>{/each}
                  <span class="cnt">{pl.cardCount}</span>
                </div>
              {/if}
            {/if}
            {#if oc}<div class="outc {oc.outcome}">{oc.outcome === "win" ? "🏆 " : ""}{oc.delta > 0 ? "+" + oc.delta : oc.delta}</div>{/if}
          {:else}
            <button class="btn btn-sm sit" onclick={() => onSit(seatNo)}>Sit</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .felt-shell { display: flex; justify-content: center; padding: 10px 0 20px; }
  .felt {
    width: min(900px, 96vw); min-height: 300px; padding: 22px; border-radius: 24px;
    background: radial-gradient(ellipse at center, #2e7d55 0%, #1f6043 70%, #17402f 100%);
    border: 12px solid #5b3a24; box-shadow: inset 0 0 60px rgba(0,0,0,0.4), 0 20px 40px rgba(0,0,0,0.35);
    display: flex; flex-direction: column; gap: 18px; color: #eafaf1;
  }
  .pile { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .pilecards { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: #fbfbfd; color: #1a1a1a;
    border-radius: 8px; padding: 8px 10px; font-weight: 800; font-size: 20px; line-height: 1; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  .card.big { font-size: 30px; padding: 14px 16px; }
  .card.red, .red { color: #c0392b; }
  .suit { font-size: 0.85em; }
  .pilenote { font-size: 12px; opacity: 0.85; }
  .waiting { font-size: 14px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .seat {
    background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
    padding: 10px; min-height: 84px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
  }
  .seat.toact { border-color: #ffd166; box-shadow: 0 0 0 2px rgba(255,209,102,0.35); }
  .seat.mine { background: rgba(108,207,255,0.12); }
  .seat.won { border-color: #7be0a0; box-shadow: 0 0 0 2px rgba(123,224,160,0.4); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .backs { display: flex; align-items: center; gap: 1px; flex-wrap: wrap; justify-content: center; }
  .back { font-size: 22px; color: #274b8f; }
  .cnt { font-size: 12px; font-weight: 700; margin-left: 4px; opacity: 0.9; }
  .count { font-size: 12px; opacity: 0.85; }
  .outc { font-size: 12.5px; font-weight: 800; }
  .outc.win { color: #7be0a0; }
  .outc.lose { color: #ffb3b8; }
  .sit { background: rgba(255,255,255,0.9); color: #143; }
</style>
