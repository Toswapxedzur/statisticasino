// Keno — banked. Each player marks 1–10 spots on an 80-number ticket and bets;
// then 20 numbers are drawn (shared) and the ticket pays by how many spots were
// CAUGHT, via a per-(spots, catches) paytable. Payouts are capped at 1000:1 so the
// bot banker stays sanely funded. Settlement is banked (sums to zero).

import { bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = { minBet: 1, maxSpots: 10, draw: 20 };

// PAYS[spots][catches] = net multiplier (to 1). Missing entries pay nothing.
export const PAYS = {
  1: { 1: 2 },
  2: { 2: 10 },
  3: { 2: 1, 3: 25 },
  4: { 2: 1, 3: 3, 4: 60 },
  5: { 3: 2, 4: 15, 5: 200 },
  6: { 3: 1, 4: 3, 5: 30, 6: 400 },
  7: { 4: 2, 5: 12, 6: 100, 7: 700 },
  8: { 5: 8, 6: 40, 7: 300, 8: 900 },
  9: { 5: 4, 6: 20, 7: 100, 8: 400, 9: 1000 },
  10: { 5: 2, 6: 10, 7: 40, 8: 200, 9: 500, 10: 1000 }
};

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}

function resolveAndSettle(state) {
  state.drawn = state.deck.slice(0, state.config.draw);
  const drawnSet = new Set(state.drawn);
  const per = state.players.map((p) => {
    if (!p.spots.length || p.amount < state.config.minBet) return { seat: p.seat, delta: 0, outcome: "skip", spots: [], catches: 0 };
    const catches = p.spots.filter((n) => drawnSet.has(n)).length;
    const mult = (PAYS[p.spots.length] || {})[catches] || 0;
    return { seat: p.seat, delta: mult > 0 ? p.amount * mult : -p.amount, outcome: mult > 0 ? "win" : "lose", spots: p.spots, catches };
  });
  state.results = bankedResults(per, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const keno = {
  key: "keno",
  name: "Keno",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 1000,
  deck: () => Array.from({ length: 80 }, (_, i) => i + 1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "keno",
      phase: "pick",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      drawn: [],
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, spots: [], amount: 0, done: false })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    state.toActSeat = firstWhere(state, (p) => !p.done);
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    const p = state.players.find((x) => x.seat === state.toActSeat);
    if (!p) return { toActSeat: null, actions: [] };
    return { toActSeat: state.toActSeat, actions: [{ type: "pick", minBet: state.config.minBet, maxTotal: p.startStack, maxSpots: state.config.maxSpots }] };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    if (action.type !== "pick") throw new RangeError(`illegal action: ${action.type}`);

    const spots = [...new Set((Array.isArray(action.spots) ? action.spots : []).map((n) => Math.floor(Number(n))))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 80)
      .slice(0, next.config.maxSpots);
    const amount = spots.length ? clampBet(action.amount, next.config.minBet, p.startStack) : 0;
    p.spots = spots;
    p.amount = amount;
    p.done = true;
    const events = [{ type: "pick", seat: p.seat, spots: spots.length }];

    const nextPicker = firstWhere(next, (x) => !x.done);
    if (nextPicker !== null) { next.toActSeat = nextPicker; return { state: next, events }; }
    resolveAndSettle(next);
    events.push({ type: "drawn" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) { return { type: "pick", seat, spots: [], amount: 0 }; }, // timeout = skip
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "keno",
      phase: state.phase,
      pickGame: true, // tells the client to use the number-pick UI
      maxSpots: state.config.maxSpots,
      drawn: state.phase === "complete" ? [...state.drawn] : [],
      tickets: state.players.map((p) => ({ seat: p.seat, spots: [...p.spots], amount: p.amount })),
      results: state.results,
      toActSeat: state.toActSeat
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    const a = menu.actions[0];
    return { phase: "pick", pickSelection: true, minBet: a.minBet, maxTotal: a.maxTotal, maxSpots: a.maxSpots };
  }
};
