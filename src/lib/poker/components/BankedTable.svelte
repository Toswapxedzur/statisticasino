<script>
  // Generic banked-game table (blackjack, casino-holdem, …). Renders whatever the
  // game's public view provides: the House (dealer) hand, an optional COMMUNITY
  // row, each player's HAND (cards + wager + status), and per-seat outcomes. New
  // banked games render here with no new component.

  let { view, me, onSit = () => {} } = $props();

  const round = $derived(view?.round || null);
  const dealer = $derived(round?.dealer || null);
  const community = $derived(round?.community || []);
  const results = $derived(round?.results || null);
  const maxSeats = $derived(view?.config?.maxSeats ?? 6);
  const bankerSeat = $derived(view?.bankerSeat ?? null);

  const seatByNo = $derived(new Map((view?.seats || []).map((s) => [s.seat, s])));
  const handBySeat = $derived(new Map((round?.hands || []).map((h) => [h.seat, h])));
  const mySeatNo = $derived(me ? (view?.seats || []).find((s) => s.userId === me.id)?.seat ?? null : null);
  const playerSeats = $derived(Array.from({ length: maxSeats }, (_, i) => i).filter((i) => i !== bankerSeat));
  const banker = $derived(bankerSeat != null ? seatByNo.get(bankerSeat) : null);

  const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const outcomeOf = (seat) => (results ? results.find((r) => r.seat === seat) || null : null);
  // Dealer summary line differs by game (blackjack shows a total; casino-holdem a
  // qualification), so just show whatever fields are present.
  const dealerNote = $derived(
    dealer
      ? (dealer.value != null ? dealer.value + (dealer.bust ? " bust" : "") : "")
        + (dealer.hand ? " " + dealer.hand : "")
        + (dealer.qualified === false ? " (no qualify)" : "")
      : ""
  );
</script>

<section class="felt-shell">
  <div class="felt">
    <div class="house">
      <div class="house-label">House{#if banker}<span class="bankroll"> · {banker.stack.toLocaleString()}</span>{/if}</div>
      <div class="cards">
        {#if dealer && dealer.cards.length}
          {#each dealer.cards as c}
            {#if c === "??"}<span class="card back">🂠</span>
            {:else}<span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>{/if}
          {/each}
          {#if dealerNote}<span class="val">{dealerNote}</span>{/if}
        {:else}<span class="waiting muted">waiting…</span>{/if}
      </div>
    </div>

    {#if community.length}
      <div class="community">
        <div class="community-label">Board</div>
        <div class="cards">
          {#each community as c}
            <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="seats">
      {#each playerSeats as seatNo (seatNo)}
        {@const s = seatByNo.get(seatNo)}
        {@const hand = handBySeat.get(seatNo)}
        {@const outcome = outcomeOf(seatNo)}
        <div class="seat" class:toact={round?.toActSeat === seatNo} class:mine={seatNo === mySeatNo}>
          {#if s}
            <div class="who"><span class="nm">{s.name}</span><span class="stk">{s.stack.toLocaleString()}</span></div>
            <div class="cards small">
              {#if hand && hand.cards.length}
                {#each hand.cards as c}
                  <span class="card" class:red={c[1] === "d" || c[1] === "h"}>{c[0]}<span class="suit">{SUIT[c[1]]}</span></span>
                {/each}
                {#if hand.value != null}<span class="val" class:bust={hand.bust}>{hand.value}{hand.blackjack ? " BJ" : hand.bust ? " bust" : ""}</span>{/if}
                {#if hand.folded}<span class="val muted">folded</span>{/if}
              {:else if s.sittingOut}<span class="muted small">sitting out</span>
              {:else}<span class="muted small">—</span>{/if}
            </div>
            {#if hand}
              <div class="bet">
                {#if hand.bet}bet {hand.bet.toLocaleString()}{/if}
                {#if hand.ante}ante {hand.ante.toLocaleString()}{#if hand.call} + call {hand.call.toLocaleString()}{/if}{/if}
              </div>
            {/if}
            {#if outcome}
              <div class="outcome {outcome.outcome}">
                {outcome.outcome === "blackjack" ? "Blackjack!" : outcome.outcome}
                {outcome.delta > 0 ? "+" + outcome.delta : outcome.delta}
              </div>
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
    width: min(900px, 96vw); min-height: 340px; padding: 22px; border-radius: var(--r-panel);
    display: flex; flex-direction: column; gap: 16px; color: var(--text);
  }
  .house, .community { text-align: center; }
  .house-label, .community-label { font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; margin-bottom: 6px; }
  .bankroll { opacity: 0.8; font-variant-numeric: tabular-nums; }
  .cards { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; min-height: 46px; }
  .cards.small { min-height: 40px; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 6px; padding: 6px 8px; font-weight: 700; font-size: 16px; line-height: 1;
    box-shadow: var(--shadow-card); margin-bottom: 0;
  }
  .cards.small .card { font-size: 14px; padding: 5px 7px; }
  .card.red { color: var(--card-red); }
  .card.back { background: var(--accent); color: var(--on-accent); }
  .suit { font-size: 0.9em; }
  .val { font-size: 13px; font-weight: 700; opacity: 0.95; margin-left: 4px; }
  .val.bust { color: var(--danger); }
  .waiting { font-size: 13px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
  .seat {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    padding: 10px; min-height: 96px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .seat.toact { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); transform: translateY(-1px); }
  .seat.mine { background: var(--surface-2); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .bet { font-size: 11.5px; opacity: 0.85; }
  .outcome { font-size: 12px; font-weight: 700; }
  .outcome.win, .outcome.blackjack, .outcome.no-qualify { color: var(--ok); }
  .outcome.lose { color: var(--danger); }
  .outcome.push { color: var(--gold-ink); }
  .small { font-size: 11.5px; }
</style>
