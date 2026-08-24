// Ultimate Texas Hold'em — banked hold'em vs the house with one Play bet made at
// whichever street you choose (earlier = bigger). Round: post ante + an equal
// blind → 2 hole each + 2 to the dealer → PREFLOP check / play 4× / play 3× →
// flop → check / play 2× → turn+river → play 1× / fold → showdown. Dealer
// qualifies with a pair+. Ante pays 1:1 (pushes if the dealer doesn't qualify),
// Play pays 1:1, the Blind pays a paytable on a straight or better.

import { shoe, dealHole, dealCommunity, take, evaluate7, compareRank, bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = { minBet: 1 };

// Blind paytable by evaluator category (paid on a WIN with a straight+).
function blindMult(rank) {
  switch (rank.category) {
    case 8: return rank.ranks[0] === 14 ? 500 : 50; // royal / straight flush
    case 7: return 10;  // quads
    case 6: return 3;   // full house
    case 5: return 1.5; // flush (3:2)
    case 4: return 1;   // straight
    default: return 0;  // less than a straight → blind pushes
  }
}

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}
const stillDeciding = (p) => p.play === 0 && !p.folded;

function finish(state) {
  if (state.community.length < 5) dealCommunity(state, 5 - state.community.length);
  state.dealer.hidden = false;
  const board = state.community;
  const dRank = evaluate7([...state.dealer.cards, ...board]);
  const dOk = dRank.category >= 1;
  const perSeat = state.players.map((p) => {
    if (p.folded) return { seat: p.seat, delta: -(p.ante + p.blind), outcome: "fold" };
    const rank = evaluate7([...p.cards, ...board]);
    const cmp = compareRank(rank, dRank);
    let delta;
    let outcome;
    if (cmp > 0) {
      delta = p.play + (dOk ? p.ante : 0) + Math.floor(p.blind * blindMult(rank));
      outcome = "win";
    } else if (cmp === 0) { delta = 0; outcome = "push"; }
    else { delta = -(p.ante + p.blind + p.play); outcome = "lose"; }
    return { seat: p.seat, delta, outcome, hand: rank.name };
  });
  state.dealer.rank = dRank;
  state.dealer.qualified = dOk;
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

// Deal the next street (or finish) and hand the turn to the first still-deciding
// player; skip empty streets when everyone has already bet or folded.
function advance(state) {
  if (state.phase === "preflop") { dealCommunity(state, 3); state.phase = "flop"; }
  else if (state.phase === "flop") { dealCommunity(state, 2); state.phase = "river"; }
  else { finish(state); return; }
  state.players.forEach((p) => { if (stillDeciding(p)) p.acted = false; });
  const next = firstWhere(state, (p) => stillDeciding(p) && !p.acted);
  if (next === null) advance(state);
  else state.toActSeat = next;
}

function deal(state) {
  dealHole(state, state.players, 2);
  state.dealer.cards.push(...take(state, 2));
  state.phase = "preflop";
  state.players.forEach((p) => { p.acted = false; });
  state.toActSeat = firstWhere(state, (p) => stillDeciding(p) && !p.acted);
}

export const ultimateHoldem = {
  key: "ultimate-holdem",
  name: "Ultimate Texas Hold'em",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 90, // 4× play + ante + 500× blind on a royal ≈ 84× the total stake
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "ultimate-holdem",
      phase: "ante",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      community: [],
      dealer: { cards: [], hidden: true },
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, ante: 0, blind: 0, play: 0, folded: false, acted: false, cards: [] })),
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
      const max = Math.max(state.config.minBet, Math.floor(p.startStack / 6)); // ante+blind+4× play ≤ stack
      return { toActSeat: state.toActSeat, actions: [{ type: "ante", min: state.config.minBet, max }] };
    }
    if (state.phase === "preflop") {
      return { toActSeat: state.toActSeat, actions: [{ type: "check" }, { type: "play4x", amount: p.ante * 4 }, { type: "play3x", amount: p.ante * 3 }] };
    }
    if (state.phase === "flop") {
      return { toActSeat: state.toActSeat, actions: [{ type: "check" }, { type: "play2x", amount: p.ante * 2 }] };
    }
    return { toActSeat: state.toActSeat, actions: [{ type: "play1x", amount: p.ante }, { type: "fold" }] }; // river
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const events = [];

    if (next.phase === "ante") {
      if (action.type !== "ante") throw new Error("must post an ante");
      const max = Math.max(next.config.minBet, Math.floor(p.startStack / 6));
      p.ante = clampBet(action.amount, next.config.minBet, max);
      p.blind = p.ante;
      events.push({ type: "ante", seat: p.seat, amount: p.ante });
      const nextAnte = firstWhere(next, (x) => x.ante === 0, p.seat);
      if (nextAnte !== null) { next.toActSeat = nextAnte; return { state: next, events }; }
      deal(next);
      events.push({ type: "dealt" });
      return { state: next, events };
    }

    const mult = { play4x: 4, play3x: 3, play2x: 2, play1x: 1 }[action.type];
    if (mult != null) { p.play = p.ante * mult; }
    else if (action.type === "fold") { p.folded = true; }
    else if (action.type === "check") { /* stays in */ }
    else throw new RangeError(`illegal action: ${action.type}`);
    p.acted = true;
    events.push({ type: action.type, seat: p.seat });

    const nextDecider = firstWhere(next, (x) => stillDeciding(x) && !x.acted);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }
    advance(next);
    events.push({ type: "street" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    if (state.phase === "ante") return { type: "ante", seat, amount: state.config.minBet };
    if (state.phase === "river") return { type: "fold", seat };
    return { type: "check", seat };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "ultimate-holdem",
      phase: state.phase,
      community: [...state.community],
      dealer: {
        cards: state.dealer.cards.length ? (state.dealer.hidden ? state.dealer.cards.map(() => "??") : [...state.dealer.cards]) : [],
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
