<script>
  // Renders a blackjack table from the server's public view:
  //   view.round = { phase, dealer:{cards,value,bust}, hands:[{seat,cards,bet,value,
  //                  bust,blackjack,done}], toActSeat, results }
  //   view.seats = [{seat,userId,name,stack,connected,inHand,isBanker,sittingOut}]
  // The house (banker) sits at view.bankerSeat and plays the dealer hand shown up
  // top; players ring the felt below. Empty seats offer a Sit button.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || null);
  const dealer = $derived(round?.dealer || null);
  const results = $derived(round?.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);

  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round?.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(
    me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null
  );

  // Non-banker seats in order (the players' ring).
  const playerSeats = $derived(
    Array.from({ length: maxSeats }, (_, i) => i).filter((i) => i !== bankerSeat)
  );
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  function outcomeOf(seat) {
    if (!results) return null;
    return results.find((r) => r.seat === seat) || null;
  }
</script>

<section class="felt-shell">
  <div class="felt">
    <!-- House / dealer -->
    <div class="house">
      <div class="house-label">
        House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}
      </div>
      <div class="cards">
        {#if dealer && dealer.cards.length}
          {#each dealer.cards as c}
            {#if c === "??"}
              <span class="card back">🂠</span>
            {:else}
              <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
            {/if}
          {/each}
          {#if dealer.value != null}<span class="val" class:bust={dealer.bust}>{dealer.value}{dealer.bust ? " bust" : ""}</span>{/if}
        {:else}
          <span class="waiting muted">waiting for bets…</span>
        {/if}
      </div>
    </div>

    <!-- Players -->
    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const hand = handBySeat.get(seatNo)}
        {@const outcome = outcomeOf(seatNo)}
        <div class="seat" class:toact={round?.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who">
              <span class="nm">{s.name}</span>
              <span class="stk">{s.stack.toLocaleString()}</span>
            </div>
            <div class="cards small">
              {#if hand && hand.cards.length}
                {#each hand.cards as c}
                  <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
                {/each}
                <span class="val" class:bust={hand.bust}>{hand.value}{hand.blackjack ? " BJ" : hand.bust ? " bust" : ""}</span>
              {:else if s.sittingOut}
                <span class="muted small">sitting out</span>
              {:else}
                <span class="muted small">—</span>
              {/if}
            </div>
            {#if hand && hand.bet}<div class="bet">bet {hand.bet.toLocaleString()}</div>{/if}
            {#if outcome}
              <div class="outcome {outcome.outcome}">
                {outcome.outcome === "blackjack" ? "Blackjack!" : outcome.outcome}
                {outcome.delta > 0 ? "+" + outcome.delta : outcome.delta}
              </div>
            {/if}
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
    width: min(900px, 96vw); min-height: 340px; padding: 22px;
    border-radius: 24px;
    background: radial-gradient(ellipse at center, #2e7d55 0%, #1f6043 70%, #17402f 100%);
    border: 12px solid #5b3a24;
    box-shadow: inset 0 0 60px rgba(0,0,0,0.4), 0 20px 40px rgba(0,0,0,0.35);
    display: flex; flex-direction: column; gap: 20px; color: #eafaf1;
  }
  .house { text-align: center; }
  .house-label { font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.85; margin-bottom: 8px; }
  .bankroll { opacity: 0.8; font-variant-numeric: tabular-nums; }

  .cards { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; min-height: 46px; }
  .cards.small { min-height: 40px; }
  .card {
    display: inline-flex; align-items: center; gap: 1px;
    background: #fbfbfd; color: #1a1a1a; border-radius: 6px;
    padding: 6px 8px; font-weight: 700; font-size: 16px; line-height: 1;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }
  .cards.small .card { font-size: 14px; padding: 5px 7px; }
  .card.red { color: #c0392b; }
  .card.back { background: #274b8f; color: #dfe8ff; }
  .suit { font-size: 0.9em; }
  .val { font-size: 13px; font-weight: 700; opacity: 0.95; margin-left: 4px; }
  .val.bust { color: #ffb3b8; }
  .waiting { font-size: 13px; }

  .seats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }
  .seat {
    background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 10px; min-height: 96px;
    display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
  }
  .seat.toact { border-color: #ffd166; box-shadow: 0 0 0 2px rgba(255,209,102,0.35); }
  .seat.mine { background: rgba(108,207,255,0.12); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .bet { font-size: 11.5px; opacity: 0.85; }
  .outcome { font-size: 12px; font-weight: 700; }
  .outcome.win, .outcome.blackjack { color: #7be0a0; }
  .outcome.lose { color: #ffb3b8; }
  .outcome.push { color: #ffe08a; }
  .small { font-size: 11.5px; }
  .sit { background: rgba(255,255,255,0.9); color: #143; }
</style>
