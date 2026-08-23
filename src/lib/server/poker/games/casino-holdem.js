// Casino Hold'em — a "banked" poker game (each player vs. the house, not each
// other). It's the clearest "hole cards + community cards + bets" game, so it's
// the reference build on the shared toolkit: it reuses the poker evaluator
// (evaluate7) and the deal/settle primitives, and just adds its own one-decision
// betting loop.
//
// Round: ante → deal 2 hole to each player + 2 to the dealer + a flop → each
// player Calls (2× ante) or Folds → turn + river → showdown. The dealer must
// QUALIFY with a pair of fours or better; settlement is banked (sums to zero).

import { shoe, take, dealHole, dealCommunity, evaluate7, compareRank, bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = {
  minBet: 1,
  // Ante bonus paytable (paid on the ante when the player makes a straight+),
  // keyed by the evaluator category. Royal flush is a category-8 ace-high hand.
  anteBonus: { straight: 1, flush: 2, fullhouse: 3, quads: 10, straightflush: 20, royal: 100 }
};

function resolveConfig(raw) {
  return { ...DEFAULTS, ...(raw || {}), anteBonus: { ...DEFAULTS.anteBonus, ...(raw?.anteBonus || {}) } };
}

// Dealer qualifies with a pair of fours or better.
function qualifies(rank) {
  return rank.category >= 2 || (rank.category === 1 && rank.ranks[0] >= 4);
}

// Ante-bonus multiplier for the player's final hand (0 for weaker than a straight).
function bonusMultiplier(rank, table) {
  switch (rank.category) {
    case 8: return rank.ranks[0] === 14 ? table.royal : table.straightflush;
    case 7: return table.quads;
    case 6: return table.fullhouse;
    case 5: return table.flush;
    case 4: return table.straight;
    default: return 0;
  }
}

function seatsInOrder(state) {
  return state.players.map((p) => p.seat).sort((a, b) => a - b);
}
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of seatsInOrder(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}

function deal(state) {
  dealHole(state, state.players, 2);
  state.dealer.cards.push(...take(state, 2));
  dealCommunity(state, 3); // flop
  state.phase = "decision";
  state.toActSeat = firstWhere(state, () => true);
}

function finish(state) {
  dealCommunity(state, 5 - state.community.length); // turn + river
  state.dealer.hidden = false;
  const board = state.community;
  const dealerRank = evaluate7([...state.dealer.cards, ...board]);
  const dealerOk = qualifies(dealerRank);

  const perSeat = state.players.map((p) => {
    const ante = p.ante;
    if (p.folded) return { seat: p.seat, delta: -ante, outcome: "fold" };
    const rank = evaluate7([...p.cards, ...board]);
    const bonus = ante * bonusMultiplier(rank, state.config.anteBonus);
    const cmp = compareRank(rank, dealerRank);
    let delta;
    let outcome;
    if (!dealerOk) { delta = ante + bonus; outcome = "no-qualify"; }           // ante 1:1, call push
    else if (cmp > 0) { delta = ante + p.call + bonus; outcome = "win"; }       // ante + call 1:1
    else if (cmp === 0) { delta = 0; outcome = "push"; }
    else { delta = -(ante + p.call); outcome = "lose"; }
    return { seat: p.seat, delta, outcome, hand: rank.name };
  });

  state.dealer.rank = dealerRank;
  state.dealer.qualified = dealerOk;
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const casinoHoldem = {
  key: "casino-holdem",
  name: "Casino Hold'em",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  deck: () => shoe(1),

  startRound(ctx) {
    const config = resolveConfig(ctx.config);
    const state = {
      game: "casino-holdem",
      phase: "ante",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      community: [],
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
      // Cap the ante so the player can always afford the 2x call if they choose.
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

    // decision phase — each player calls or folds exactly once, in seat order.
    if (action.type === "fold") { p.folded = true; }
    else if (action.type === "call") {
      if (p.startStack < p.ante * 3) throw new Error("cannot afford the call");
      p.call = p.ante * 2;
    } else throw new RangeError(`illegal action: ${action.type}`);
    events.push({ type: action.type, seat: p.seat });

    // Next player who has neither folded nor called yet.
    const nextDecider = firstWhere(next, (x) => !x.folded && x.call === 0);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }
    finish(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },

  defaultAction(state, seat) {
    // Timeout: post the minimum ante, or fold the decision.
    return state.phase === "ante" ? { type: "ante", seat, amount: state.config.minBet } : { type: "fold", seat };
  },

  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "casino-holdem",
      phase: state.phase,
      community: [...state.community],
      dealer: {
        cards: state.dealer.hidden ? state.dealer.cards.map(() => "??") : [...state.dealer.cards],
        qualified: state.dealer.qualified ?? null,
        hand: state.dealer.rank?.name ?? null
      },
      hands: state.players.map((p) => ({
        seat: p.seat, cards: [...p.cards], ante: p.ante, call: p.call, folded: p.folded
      })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; }, // hole cards are shown (independent play vs. the house)

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    return { phase: state.phase, actions: menu.actions, callAmount: menu.actions.find((a) => a.type === "call")?.amount ?? 0 };
  }
};
