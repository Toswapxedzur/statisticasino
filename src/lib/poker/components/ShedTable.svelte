<script>
  import { fade, scale } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

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
          {#each pileCards as t, i (t + '-' + i)}<span class="card big" class:red={isRed(t[1])} in:scale={{ start: 0.6, duration: d(DUR.base), delay: d(i * 35) }}>{t[0]}<span class="suit">{SUIT[t[1]]}</span></span>{/each}
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
            {#if oc}<div class="outc {oc.outcome}" transition:fade={{ duration: d(DUR.base) }}>{oc.outcome === "win" ? "🏆 " : ""}{oc.delta > 0 ? "+" + oc.delta : oc.delta}</div>{/if}
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
    display: flex; flex-direction: column; gap: 18px; color: var(--text);
  }
  .pile { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .pilecards { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; }
  .card {
    display: inline-flex; align-items: center; gap: 1px; background: var(--card-face); color: var(--card-ink);
    border-radius: 8px; padding: 8px 10px; font-weight: 800; font-size: 20px; line-height: 1; box-shadow: var(--shadow-card); margin-bottom: 0;
  }
  .card.big { font-size: 30px; padding: 14px 16px; }
  .card.red, .red { color: var(--card-red); }
  .suit { font-size: 0.85em; }
  .pilenote { font-size: 12px; opacity: 0.85; }
  .waiting { font-size: 14px; }
  .seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .seat {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    padding: 10px; min-height: 84px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .seat.toact { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); transform: translateY(-1px); }
  .seat.mine { background: var(--surface-2); }
  .seat.won { box-shadow: 0 0 0 2px var(--ok), var(--shadow-card); }
  .who { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; gap: 8px; }
  .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stk { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .backs { display: flex; align-items: center; gap: 1px; flex-wrap: wrap; justify-content: center; }
  .back { font-size: 22px; color: var(--accent-ink); }
  .cnt { font-size: 12px; font-weight: 700; margin-left: 4px; opacity: 0.9; }
  .count { font-size: 12px; opacity: 0.85; }
  .outc { font-size: 12.5px; font-weight: 800; }
  .outc.win { color: var(--ok); }
  .outc.lose { color: var(--danger); }
</style>
