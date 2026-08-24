// Pai Gow Poker — banked. Each player and the dealer get 7 cards and split them
// into a 5-card "back" hand and a 2-card "front" hand; the front must NOT outrank
// the back (a foul, auto-corrected to the best legal split). You win only by
// beating the dealer on BOTH hands (copies go to the bank); win one / lose one is
// a push. Wins pay even money minus a 5% commission. No joker (52-card deck).

import { shoe, take, bestHand, compareRank, bankedResults } from "./toolkit.js";

export const DEFAULTS = { minBet: 1, commission: 20 }; // 20 → keep 19/20 = 0.95 on a win

const RV = { A: 14, K: 13, Q: 12, J: 11, T: 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 };
function rank2(cards) {
  const a = RV[cards[0][0]];
  const b = RV[cards[1][0]];
  return a === b ? { category: 1, ranks: [a] } : { category: 0, ranks: [Math.max(a, b), Math.min(a, b)] };
}

// Best legal split: maximise the back hand, then the front (a valid split always
// exists — the two lowest cards in front). Brute force over all C(7,2) fronts.
function bestSplit(seven) {
  let best = null;
  for (let i = 0; i < 7; i += 1) {
    for (let j = i + 1; j < 7; j += 1) {
      const front = [seven[i], seven[j]];
      const back = seven.filter((_, idx) => idx !== i && idx !== j);
      const rBack = bestHand(back);
      const rFront = rank2(front);
      if (compareRank(rBack, rFront) < 0) continue; // foul
      if (best === null || compareRank(rBack, best.rBack) > 0
        || (compareRank(rBack, best.rBack) === 0 && compareRank(rFront, best.rFront) > 0)) {
        best = { front, back, rBack, rFront };
      }
    }
  }
  return best;
}

// Split around a chosen front pair (2 cards). Falls back to bestSplit on a foul or
// an invalid choice.
function splitWithFront(seven, front) {
  if (!Array.isArray(front) || front.length !== 2 || front[0] === front[1] || !front.every((c) => seven.includes(c))) {
    return bestSplit(seven);
  }
  const back = seven.filter((c) => !front.includes(c));
  const rBack = bestHand(back);
  const rFront = rank2(front);
  if (compareRank(rBack, rFront) < 0) return bestSplit(seven); // foul → auto-correct
  return { front: [...front], back, rBack, rFront };
}

function outcomeVs(pSplit, dSplit) {
  const backWin = compareRank(pSplit.rBack, dSplit.rBack) > 0;
  const frontWin = compareRank(pSplit.rFront, dSplit.rFront) > 0;
  if (backWin && frontWin) return "win";
  if (!backWin && !frontWin) return "lose"; // lost or tied both (copies to the bank)
  return "push";
}

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}

function deal(state) {
  for (const p of state.players) p.hand = take(state, 7);
  state.dealer.hand = take(state, 7);
  state.dealer.split = bestSplit(state.dealer.hand);
  state.phase = "set";
  state.toActSeat = firstWhere(state, () => true);
}

function finish(state) {
  state.dealer.hidden = false;
  const d = state.dealer.split;
  const perSeat = state.players.map((p) => {
    const res = outcomeVs(p.split, d);
    let delta;
    if (res === "win") delta = Math.floor((p.ante * (state.config.commission - 1)) / state.config.commission);
    else if (res === "lose") delta = -p.ante;
    else delta = 0;
    return { seat: p.seat, delta, outcome: res };
  });
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.phase = "complete";
  state.toActSeat = null;
}

export const paiGow = {
  key: "pai-gow",
  name: "Pai Gow Poker",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 1, // a win pays 0.95:1
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "pai-gow",
      phase: "set",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      dealer: { hand: [], split: null, hidden: true },
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, ante: config.minBet, hand: [], split: null })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    deal(state); // fixed bet = minBet; deal 7 each and go straight to the set decision
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    return { toActSeat: state.toActSeat, actions: [{ type: "set" }] };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    if (action.type !== "set") throw new RangeError(`illegal action: ${action.type}`);
    p.split = action.auto ? bestSplit(p.hand) : splitWithFront(p.hand, action.front);
    const events = [{ type: "set", seat: p.seat }];

    const nextSetter = firstWhere(next, (x) => !x.split);
    if (nextSetter !== null) { next.toActSeat = nextSetter; return { state: next, events }; }
    finish(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) { return { type: "set", seat, auto: true }; }, // timeout = house way
  settle(state) { return state.results || []; },

  publicView(state) {
    const dealer = state.dealer;
    return {
      game: "pai-gow",
      phase: state.phase,
      setGame: true, // tells the client to use the split UI + two-hand felt
      dealer: {
        front: dealer.hidden ? [] : (dealer.split?.front ?? []),
        back: dealer.hidden ? [] : (dealer.split?.back ?? []),
        hidden: dealer.hidden
      },
      hands: state.players.map((p) => ({
        seat: p.seat,
        ante: p.ante,
        cards: p.split ? [] : [...p.hand], // 7 cards until set
        front: p.split?.front ?? [],
        back: p.split?.back ?? []
      })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    if (state.toActSeat !== seat) return null;
    const p = state.players.find((x) => x.seat === seat);
    return { phase: "set", setSelection: true, cards: [...p.hand] };
  }
};
