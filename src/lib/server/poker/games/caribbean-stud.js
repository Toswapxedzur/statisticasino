// Caribbean Stud — a banked 5-card stud vs the house. Round: ante → deal each
// player 5 cards + the dealer 5 (one up) → each player Calls (2× ante) or Folds
// seeing their hand and the dealer's up-card → showdown. The dealer QUALIFIES
// with Ace-King-high or better; if it doesn't, the ante pays 1:1 and the call
// pushes. When it does and the player wins, the call bet pays a paytable
// (pair 1:1 … royal 100:1). Settlement is banked (sums to zero).

import { shoe, take, dealHole, bestHand, compareRank, bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = { minBet: 1 };

// Call-bet paytable by evaluator category (royal is a straight flush to the ace).
function callMultiplier(rank) {
  switch (rank.category) {
    case 8: return rank.ranks[0] === 14 ? 100 : 50; // royal / straight flush
    case 7: return 20; // quads
    case 6: return 7;  // full house
    case 5: return 5;  // flush
    case 4: return 4;  // straight
    case 3: return 3;  // trips
    case 2: return 2;  // two pair
    default: return 1; // one pair / high card
  }
}

// Dealer qualifies with a pair or better, or Ace-King high.
function dealerQualifies(rank) {
  if (rank.category >= 1) return true;
  return rank.ranks[0] === 14 && rank.ranks[1] === 13;
}

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}

function deal(state) {
  dealHole(state, state.players, 5);
  state.dealer.cards.push(...take(state, 5));
  state.phase = "decision";
  state.toActSeat = firstWhere(state, () => true);
}

function finish(state) {
  state.dealer.hidden = false;
  const dRank = bestHand(state.dealer.cards);
  const dOk = dealerQualifies(dRank);
  const perSeat = state.players.map((p) => {
    if (p.folded) return { seat: p.seat, delta: -p.ante, outcome: "fold" };
    const rank = bestHand(p.cards);
    const cmp = compareRank(rank, dRank);
    let delta;
    let outcome;
    if (!dOk) { delta = p.ante; outcome = "no-qualify"; }                      // ante 1:1, call push
    else if (cmp > 0) { delta = p.ante + p.call * callMultiplier(rank); outcome = "win"; }
    else if (cmp === 0) { delta = 0; outcome = "push"; }
    else { delta = -(p.ante + p.call); outcome = "lose"; }
    return { seat: p.seat, delta, outcome, hand: rank.name };
  });
  state.dealer.rank = dRank;
  state.dealer.qualified = dOk;
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const caribbeanStud = {
  key: "caribbean-stud",
  name: "Caribbean Stud",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 70, // ante + 2×ante call at the 100:1 royal ≈ 67× the total stake
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "caribbean-stud",
      phase: "ante",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      dealer: { cards: [], hidden: true },
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, ante: 0, call: 0, folded: false, cards: [] })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    state.toActSeat = firstWhere(state, (p) => p.ante === 0);
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    const p = state.players.find((x) => x.seat === state.toActSeat);
    if (!p) return { toActSeat: null, actions: [] };
    if (state.phase === "ante") {
      const max = Math.max(state.config.minBet, Math.floor(p.startStack / 3));
      return { toActSeat: state.toActSeat, actions: [{ type: "ante", min: state.config.minBet, max }] };
    }
    const actions = [{ type: "fold" }];
    if (p.startStack >= p.ante * 3) actions.push({ type: "call", amount: p.ante * 2 });
    return { toActSeat: state.toActSeat, actions };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const events = [];

    if (next.phase === "ante") {
      if (action.type !== "ante") throw new Error("must post an ante");
      const max = Math.max(next.config.minBet, Math.floor(p.startStack / 3));
      p.ante = clampBet(action.amount, next.config.minBet, max);
      events.push({ type: "ante", seat: p.seat, amount: p.ante });
      const nextAnte = firstWhere(next, (x) => x.ante === 0, p.seat);
      if (nextAnte !== null) { next.toActSeat = nextAnte; return { state: next, events }; }
      deal(next);
      events.push({ type: "dealt" });
      return { state: next, events };
    }

    if (action.type === "fold") { p.folded = true; }
    else if (action.type === "call") {
      if (p.startStack < p.ante * 3) throw new Error("cannot afford the call");
      p.call = p.ante * 2;
    } else throw new RangeError(`illegal action: ${action.type}`);
    events.push({ type: action.type, seat: p.seat });

    const nextDecider = firstWhere(next, (x) => !x.folded && x.call === 0);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }
    finish(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    return state.phase === "ante" ? { type: "ante", seat, amount: state.config.minBet } : { type: "fold", seat };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "caribbean-stud",
      phase: state.phase,
      dealer: {
        cards: state.dealer.cards.length
          ? (state.dealer.hidden ? [state.dealer.cards[0], ...state.dealer.cards.slice(1).map(() => "??")] : [...state.dealer.cards])
          : [],
        qualified: state.dealer.qualified ?? null,
        hand: state.dealer.rank?.name ?? null
      },
      hands: state.players.map((p) => ({ seat: p.seat, cards: [...p.cards], ante: p.ante, call: p.call, folded: p.folded })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    return { phase: state.phase, actions: menu.actions, callAmount: menu.actions.find((a) => a.type === "call")?.amount ?? 0 };
  }
};
