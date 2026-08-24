// Let It Ride — banked, no dealer: you place three equal bets, get three cards +
// two shared community cards, and may PULL BACK the first two bets (the third
// always rides) as the community cards are revealed one at a time. Your final
// 5-card hand pays a paytable on each riding bet (pair of 10s 1:1 … royal
// 1000:1); a hand below a pair of tens loses the riding bets. Pulled bets are
// returned. Settlement is banked against the house.

import { shoe, dealHole, dealCommunity, bestHand, bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = { minBet: 1 };

function payout(rank) {
  switch (rank.category) {
    case 8: return rank.ranks[0] === 14 ? 1000 : 200; // royal / straight flush
    case 7: return 50;  // quads
    case 6: return 11;  // full house
    case 5: return 8;   // flush
    case 4: return 5;   // straight
    case 3: return 3;   // trips
    case 2: return 2;   // two pair
    case 1: return rank.ranks[0] >= 10 ? 1 : 0; // pair of tens or better
    default: return 0;
  }
}

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}
const ridingUnits = (p) => 1 + (p.pull2 ? 0 : 1) + (p.pull1 ? 0 : 1);

function deal(state) {
  dealHole(state, state.players, 3);
  dealCommunity(state, 2); // two community cards, revealed one at a time
  state.revealed = 0;
  state.phase = "decide1";
  state.players.forEach((p) => { p.acted = false; });
  state.toActSeat = firstWhere(state, () => true);
}

function finish(state) {
  state.revealed = 2;
  const perSeat = state.players.map((p) => {
    const rank = bestHand([...p.cards, ...state.community]);
    const mult = payout(rank);
    const units = ridingUnits(p);
    const delta = mult > 0 ? units * p.unit * mult : -(units * p.unit);
    return { seat: p.seat, delta, outcome: mult > 0 ? "win" : "lose", hand: rank.name };
  });
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const letItRide = {
  key: "let-it-ride",
  name: "Let It Ride",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 1000, // three riding bets on a royal flush
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "let-it-ride",
      phase: "ante",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      community: [],
      revealed: 0,
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, unit: 0, pull1: false, pull2: false, acted: false, cards: [] })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    state.toActSeat = firstWhere(state, (p) => p.unit === 0);
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    const p = state.players.find((x) => x.seat === state.toActSeat);
    if (!p) return { toActSeat: null, actions: [] };
    if (state.phase === "ante") {
      const max = Math.max(state.config.minBet, Math.floor(p.startStack / 3)); // three equal bets
      return { toActSeat: state.toActSeat, actions: [{ type: "ante", min: state.config.minBet, max }] };
    }
    return { toActSeat: state.toActSeat, actions: [{ type: "ride" }, { type: "pull" }] };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const events = [];

    if (next.phase === "ante") {
      if (action.type !== "ante") throw new Error("must post the bet");
      const max = Math.max(next.config.minBet, Math.floor(p.startStack / 3));
      p.unit = clampBet(action.amount, next.config.minBet, max);
      events.push({ type: "ante", seat: p.seat, amount: p.unit });
      const nextAnte = firstWhere(next, (x) => x.unit === 0, p.seat);
      if (nextAnte !== null) { next.toActSeat = nextAnte; return { state: next, events }; }
      deal(next);
      events.push({ type: "dealt" });
      return { state: next, events };
    }

    if (action.type !== "ride" && action.type !== "pull") throw new RangeError(`illegal action: ${action.type}`);
    if (action.type === "pull") { if (next.phase === "decide1") p.pull1 = true; else p.pull2 = true; }
    p.acted = true;
    events.push({ type: action.type, seat: p.seat });

    const nextDecider = firstWhere(next, (x) => !x.acted);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }

    if (next.phase === "decide1") {
      next.revealed = 1;
      next.phase = "decide2";
      next.players.forEach((x) => { x.acted = false; });
      next.toActSeat = firstWhere(next, () => true);
      events.push({ type: "reveal" });
      return { state: next, events };
    }
    finish(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    return state.phase === "ante" ? { type: "ante", seat, amount: state.config.minBet } : { type: "pull", seat };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "let-it-ride",
      phase: state.phase,
      community: state.community.slice(0, state.revealed),
      hands: state.players.map((p) => ({ seat: p.seat, cards: [...p.cards], bet: ridingUnits(p) * p.unit })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    return { phase: state.phase, actions: menu.actions };
  }
};
