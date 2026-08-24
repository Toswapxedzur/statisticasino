// Video Poker (Jacks or Better, 9/6) — banked, single decision: you're dealt five
// cards, HOLD any subset, and the rest are redrawn; the final 5-card hand pays a
// paytable (a pair of jacks 1:1 … royal 250:1). No dealer — the house just funds
// the paytable. The bet is fixed at the table minimum. Settlement is banked.

import { shoe, take, dealHole, bestHand, bankedResults } from "./toolkit.js";

export const DEFAULTS = { minBet: 1 };

export const PAYTABLE = [
  { name: "Royal Flush", pays: 250 },
  { name: "Straight Flush", pays: 50 },
  { name: "Four of a Kind", pays: 25 },
  { name: "Full House", pays: 9 },
  { name: "Flush", pays: 6 },
  { name: "Straight", pays: 4 },
  { name: "Three of a Kind", pays: 3 },
  { name: "Two Pair", pays: 2 },
  { name: "Jacks or Better", pays: 1 }
];

export function payout(rank) {
  switch (rank.category) {
    case 8: return rank.ranks[0] === 14 ? 250 : 50; // royal / straight flush
    case 7: return 25;  // four of a kind
    case 6: return 9;   // full house
    case 5: return 6;   // flush
    case 4: return 4;   // straight
    case 3: return 3;   // three of a kind
    case 2: return 2;   // two pair
    case 1: return rank.ranks[0] >= 11 ? 1 : 0; // jacks or better
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

function finish(state) {
  const perSeat = state.players.map((p) => {
    const rank = bestHand(p.cards);
    const mult = payout(rank);
    return { seat: p.seat, delta: mult > 0 ? p.bet * mult : -p.bet, outcome: mult > 0 ? "win" : "lose", hand: mult > 0 ? rank.name : null };
  });
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const videoPoker = {
  key: "video-poker",
  name: "Video Poker",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 250, // a royal flush pays 250:1
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "video-poker",
      phase: "draw",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, bet: config.minBet, cards: [], drawn: false })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    dealHole(state, state.players, 5);
    state.toActSeat = firstWhere(state, () => true);
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    return { toActSeat: state.toActSeat, actions: [{ type: "draw" }] };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    if (action.type !== "draw") throw new RangeError(`illegal action: ${action.type}`);
    const holds = Array.isArray(action.holds) ? action.holds : [];
    for (let i = 0; i < 5; i += 1) if (!holds[i]) p.cards[i] = take(next, 1)[0];
    p.drawn = true;
    const events = [{ type: "draw", seat: p.seat }];

    const nextDraw = firstWhere(next, (x) => !x.drawn);
    if (nextDraw !== null) { next.toActSeat = nextDraw; return { state: next, events }; }
    finish(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) { return { type: "draw", seat, holds: [true, true, true, true, true] }; }, // timeout = stand pat
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "video-poker",
      phase: state.phase,
      holdGame: true, // tells the client to use the hold-and-draw UI
      paytable: PAYTABLE,
      hands: state.players.map((p) => ({ seat: p.seat, cards: [...p.cards], bet: p.bet, drawn: p.drawn })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    if (state.toActSeat !== seat) return null;
    const p = state.players.find((x) => x.seat === seat);
    return { phase: "draw", holdSelection: true, cards: [...p.cards], bet: p.bet };
  }
};
