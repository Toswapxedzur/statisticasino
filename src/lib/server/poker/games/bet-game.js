// Generic "bet-selection" banked game factory. These games (Baccarat, Roulette,
// Sic Bo, …) have no personal hand to play — each player places one or more BETS
// on outcomes, then the round RESOLVES (deal / spin / roll) and every bet settles
// by a payout. This factory owns the shared flow (betting phase → resolve →
// banked settle); a game is just a `spec`:
//
//   spec = { key, name, minPlayers?, deck?, defaults?,
//     betOptions(config) -> [{ key, label, payout }],   // what you can bet on
//     resolve(state) -> void,                            // sets state.outcome
//     settleBet(bet, outcome, config) -> delta,          // net chips for one bet
//     outcomeView(state) -> { headline, hands? } }       // what the table shows

import { bankedResults } from "./toolkit.js";

export function bankedBetGame(spec) {
  const seatsInOrder = (s) => s.players.map((p) => p.seat).sort((a, b) => a - b);
  const firstUnbet = (s) => {
    for (const seat of seatsInOrder(s)) if (!s.players.find((p) => p.seat === seat).done) return seat;
    return null;
  };

  function resolveAndSettle(state) {
    spec.resolve(state);
    const per = state.players.map((p) => {
      let delta = 0;
      for (const bet of p.bets) delta += spec.settleBet(bet, state.outcome, state.config);
      return { seat: p.seat, delta, outcome: delta > 0 ? "win" : delta < 0 ? "lose" : "push", bets: p.bets };
    });
    state.results = bankedResults(per, state.bankerSeat);
    state.phase = "complete";
    state.toActSeat = null;
  }

  return {
    key: spec.key,
    name: spec.name,
    family: "banked",
    usesBanker: true,
    // Biggest payout multiple any single bet can win — the banker is funded for
    // it so a max bet on the longest-odds option is always covered.
    maxPayoutMultiple: spec.maxPayoutMultiple ?? 3,
    minPlayers: spec.minPlayers ?? 1,
    deck: spec.deck || (() => []),

    startRound(ctx) {
      const config = { ...(spec.defaults || {}), ...(ctx.config || {}) };
      const state = {
        game: spec.key, phase: "betting", config, bankerSeat: ctx.bankerSeat,
        deck: spec.deck ? [...ctx.deck] : [], deckPos: 0, outcome: null,
        players: ctx.players.filter((p) => p.seat !== ctx.bankerSeat)
          .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, bets: [], done: false })),
        toActSeat: null, results: null
      };
      if (!state.players.length) { state.phase = "complete"; state.results = []; return state; }
      state.toActSeat = firstUnbet(state);
      return state;
    },

    legalActions(state) {
      if (state.toActSeat === null) return { toActSeat: null, actions: [] };
      const p = state.players.find((x) => x.seat === state.toActSeat);
      if (!p) return { toActSeat: null, actions: [] };
      return {
        toActSeat: state.toActSeat,
        actions: [{ type: "bet", options: spec.betOptions(state.config), minBet: state.config.minBet, maxTotal: p.startStack }]
      };
    },

    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      const p = next.players.find((x) => x.seat === action.seat);
      if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
      if (action.type !== "bet") throw new RangeError("expected a bet");
      const valid = new Set(spec.betOptions(next.config).map((o) => o.key));
      const clean = [];
      let total = 0;
      for (const b of Array.isArray(action.bets) ? action.bets : []) {
        if (!valid.has(b.option)) throw new RangeError(`unknown bet: ${b.option}`);
        const amt = Math.floor(Number(b.amount));
        if (!Number.isFinite(amt) || amt < next.config.minBet) continue; // drop below-min
        total += amt;
        clean.push({ option: b.option, amount: amt });
      }
      if (total > p.startStack) throw new RangeError("bets exceed your stack");
      p.bets = clean;
      p.done = true;
      const nextSeat = firstUnbet(next);
      if (nextSeat !== null) { next.toActSeat = nextSeat; return { state: next, events: [] }; }
      resolveAndSettle(next);
      return { state: next, events: [{ type: "resolved" }] };
    },

    isComplete(state) { return state.phase === "complete"; },
    actorSeat(state) { return state.toActSeat; },
    defaultAction(state, seat) { return { type: "bet", seat, bets: [] }; }, // timeout = sit out
    settle(state) { return state.results || []; },

    publicView(state) {
      return {
        game: spec.key,
        phase: state.phase,
        betSelection: true, // tells the client to use the bet-selection UI
        betOptions: spec.betOptions(state.config),
        outcome: state.phase === "complete" ? spec.outcomeView(state) : null,
        bets: state.players.map((p) => ({ seat: p.seat, bets: p.bets })),
        toActSeat: state.toActSeat,
        results: state.results
      };
    },
    privateFor() { return null; },
    turnInfo(state, seat) {
      const menu = this.legalActions(state);
      if (menu.toActSeat !== seat) return null;
      return { phase: state.phase, betSelection: true, betOptions: spec.betOptions(state.config), minBet: state.config.minBet, maxTotal: menu.actions[0].maxTotal };
    }
  };
}
