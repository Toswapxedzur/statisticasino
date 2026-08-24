// Three Card Poker — a "banked" game on the toolkit. Each player + the dealer get
// 3 cards; the player sees theirs, then Plays (matches the ante) or Folds. The
// dealer QUALIFIES with Queen-high or better; settlement is banked.
//
// It needs its own 3-card ranking (a straight beats a flush here — straights are
// rarer with only 3 cards), so it defines rank3(); everything else (deal, settle,
// the one-decision loop) is the shared toolkit pattern.

import { shoe, take, dealHole, bankedResults, clampBet, compareRank } from "./toolkit.js";
import { RANKS } from "../engine/cards.js";

export const DEFAULTS = {
  minBet: 1,
  // Ante bonus (paid on the ante for a strong hand), by hand type.
  anteBonus: { straight: 1, trips: 4, straightflush: 5 }
};

const rankVal = (card) => RANKS.indexOf(card[0]) + 2;
const NAMES = ["High Card", "Pair", "Flush", "Straight", "Three of a Kind", "Straight Flush"];

// 3-card hand rank. Category order (strongest last, matching compareRank):
// 0 high, 1 pair, 2 flush, 3 straight, 4 trips, 5 straight flush.
export function rank3(cards) {
  const vals = cards.map(rankVal).sort((a, b) => b - a);
  const flush = cards[0][1] === cards[1][1] && cards[1][1] === cards[2][1];
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const trips = [...counts.values()].includes(3);
  const pairVal = [...counts.entries()].find(([, c]) => c === 2)?.[0] ?? null;

  const [a, b, c] = vals;
  let straight = false;
  let high = a;
  if (a - b === 1 && b - c === 1) { straight = true; }
  else if (a === 14 && b === 3 && c === 2) { straight = true; high = 3; } // wheel A-2-3

  let category;
  let ranks;
  if (straight && flush) { category = 5; ranks = [high]; }
  else if (trips) { category = 4; ranks = [a]; }
  else if (straight) { category = 3; ranks = [high]; }
  else if (flush) { category = 2; ranks = vals; }
  else if (pairVal != null) { category = 1; ranks = [pairVal, vals.find((v) => v !== pairVal)]; }
  else { category = 0; ranks = vals; }
  return { category, ranks, name: NAMES[category] };
}

// Dealer plays with Queen-high or better.
function qualifies(rank) {
  return rank.category >= 1 || rank.ranks[0] >= 12;
}
function bonusMultiplier(rank, table) {
  if (rank.category === 5) return table.straightflush;
  if (rank.category === 4) return table.trips;
  if (rank.category === 3) return table.straight;
  return 0;
}

const seatsInOrder = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred) {
  for (const seat of seatsInOrder(state)) if (pred(state.players.find((p) => p.seat === seat))) return seat;
  return null;
}

function deal(state) {
  dealHole(state, state.players, 3);
  state.dealer.cards.push(...take(state, 3));
  state.phase = "decision";
  state.toActSeat = firstWhere(state, () => true);
}

function finish(state) {
  state.dealer.hidden = false;
  const dealerRank = rank3(state.dealer.cards);
  const dealerOk = qualifies(dealerRank);
  const perSeat = state.players.map((p) => {
    const ante = p.ante;
    if (p.folded) return { seat: p.seat, delta: -ante, outcome: "fold" };
    const rank = rank3(p.cards);
    const bonus = ante * bonusMultiplier(rank, state.config.anteBonus);
    const cmp = compareRank(rank, dealerRank);
    let delta; let outcome;
    if (!dealerOk) { delta = ante + bonus; outcome = "no-qualify"; }        // ante 1:1, play push
    else if (cmp > 0) { delta = ante + p.play + bonus; outcome = "win"; }
    else if (cmp === 0) { delta = 0; outcome = "push"; }
    else { delta = -(ante + p.play); outcome = "lose"; }
    return { seat: p.seat, delta, outcome, hand: rank.name };
  });
  state.dealer.rank = dealerRank;
  state.dealer.qualified = dealerOk;
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const threeCard = {
  key: "three-card",
  name: "Three Card Poker",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 5, // ante + play + 5:1 straight-flush ante-bonus ≈ 3.5× the stake
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}), anteBonus: { ...DEFAULTS.anteBonus, ...(ctx.config?.anteBonus || {}) } };
    const state = {
      game: "three-card", phase: "ante", config,
      bankerSeat: ctx.bankerSeat, deck: [...ctx.deck], deckPos: 0,
      community: [], dealer: { cards: [], hidden: true },
      players: ctx.players.filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, ante: 0, play: 0, folded: false, cards: [] })),
      toActSeat: null, results: null
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
      const max = Math.max(state.config.minBet, Math.floor(p.startStack / 2));
      return { toActSeat: state.toActSeat, actions: [{ type: "ante", min: state.config.minBet, max }] };
    }
    const actions = [{ type: "fold" }];
    if (p.startStack >= p.ante * 2) actions.push({ type: "play", amount: p.ante });
    return { toActSeat: state.toActSeat, actions };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const events = [];
    if (next.phase === "ante") {
      if (action.type !== "ante") throw new Error("must post an ante");
      const max = Math.max(next.config.minBet, Math.floor(p.startStack / 2));
      p.ante = clampBet(action.amount, next.config.minBet, max);
      events.push({ type: "ante", seat: p.seat, amount: p.ante });
      const nextAnte = firstWhere(next, (x) => x.ante === 0);
      if (nextAnte !== null) { next.toActSeat = nextAnte; return { state: next, events }; }
      deal(next);
      return { state: next, events };
    }
    if (action.type === "fold") { p.folded = true; }
    else if (action.type === "play") {
      if (p.startStack < p.ante * 2) throw new Error("cannot afford to play");
      p.play = p.ante;
    } else throw new RangeError(`illegal action: ${action.type}`);
    events.push({ type: action.type, seat: p.seat });
    const nextDecider = firstWhere(next, (x) => !x.folded && x.play === 0);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }
    finish(next);
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
      game: "three-card",
      phase: state.phase,
      community: [],
      dealer: {
        cards: state.dealer.hidden ? state.dealer.cards.map(() => "??") : [...state.dealer.cards],
        qualified: state.dealer.qualified ?? null,
        hand: state.dealer.rank?.name ?? null
      },
      hands: state.players.map((p) => ({ seat: p.seat, cards: [...p.cards], ante: p.ante, call: p.play, folded: p.folded })),
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
