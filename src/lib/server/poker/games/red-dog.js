// Red Dog (Acey-Deucey) — banked, on two shared cards. Round: ante → deal two
// cards → if they're a PAIR, a third card decides (trips pays 11:1, else push);
// if CONSECUTIVE, it's an immediate push; otherwise the "spread" (ranks strictly
// between) is announced and each player may RAISE (double) or check, then a third
// card falls — inside the spread wins by the spread paytable, else it loses.

import { shoe, take, bankedResults, clampBet } from "./toolkit.js";

export const DEFAULTS = { minBet: 1 };

const RVAL = { A: 14, K: 13, Q: 12, J: 11, T: 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2 };
const rankOf = (c) => RVAL[c[0]];
const spreadPay = (s) => (s === 1 ? 5 : s === 2 ? 4 : s === 3 ? 2 : 1);

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function firstWhere(state, pred, afterSeat = -1) {
  for (const seat of order(state)) {
    if (seat > afterSeat && pred(state.players.find((p) => p.seat === seat))) return seat;
  }
  return null;
}
const complete = (state, perSeat, outcome) => {
  state.results = bankedResults(perSeat, state.bankerSeat);
  state.outcome = outcome;
  state.phase = "complete";
  state.toActSeat = null;
};

function settlePair(state) {
  const target = rankOf(state.community[0]);
  const third = take(state, 1)[0];
  state.community.push(third);
  const trips = rankOf(third) === target;
  complete(state, state.players.map((p) => ({ seat: p.seat, delta: trips ? p.ante * 11 : 0, outcome: trips ? "win" : "push" })), { kind: "pair", trips });
}

function settleSpread(state) {
  const lo = Math.min(rankOf(state.community[0]), rankOf(state.community[1]));
  const hi = Math.max(rankOf(state.community[0]), rankOf(state.community[1]));
  const third = take(state, 1)[0];
  state.community.push(third);
  const tv = rankOf(third);
  const between = tv > lo && tv < hi;
  const mult = spreadPay(state.spread);
  complete(state, state.players.map((p) => {
    const stake = p.ante + p.raise;
    return { seat: p.seat, delta: between ? stake * mult : -stake, outcome: between ? "win" : "lose" };
  }), { kind: "spread", between });
}

function dealTwo(state) {
  state.community.push(...take(state, 2));
  const a = rankOf(state.community[0]);
  const b = rankOf(state.community[1]);
  if (a === b) { settlePair(state); return; }
  if (Math.abs(a - b) === 1) { complete(state, state.players.map((p) => ({ seat: p.seat, delta: 0, outcome: "push" })), { kind: "consecutive" }); return; }
  state.spread = Math.abs(a - b) - 1;
  state.phase = "decision";
  state.toActSeat = firstWhere(state, () => true);
}

export const redDog = {
  key: "red-dog",
  name: "Red Dog",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,
  maxPayoutMultiple: 11, // a pair whose third card makes trips pays 11:1
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "red-dog",
      phase: "ante",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      community: [],
      spread: 0,
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, ante: 0, raise: 0, acted: false })),
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
      const max = Math.max(state.config.minBet, Math.floor(p.startStack / 2)); // keep room to double
      return { toActSeat: state.toActSeat, actions: [{ type: "ante", min: state.config.minBet, max }] };
    }
    const actions = [{ type: "check" }];
    if (p.startStack >= p.ante * 2) actions.push({ type: "raise", amount: p.ante });
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
      const nextAnte = firstWhere(next, (x) => x.ante === 0, p.seat);
      if (nextAnte !== null) { next.toActSeat = nextAnte; return { state: next, events }; }
      dealTwo(next);
      events.push({ type: "dealt" });
      return { state: next, events };
    }

    // decision phase (spread): raise (double) or check
    if (action.type === "raise") {
      if (p.startStack < p.ante * 2) throw new Error("cannot afford the raise");
      p.raise = p.ante;
    } else if (action.type === "check") {
      p.raise = 0;
    } else throw new RangeError(`illegal action: ${action.type}`);
    p.acted = true;
    events.push({ type: action.type, seat: p.seat });

    const nextDecider = firstWhere(next, (x) => !x.acted);
    if (nextDecider !== null) { next.toActSeat = nextDecider; return { state: next, events }; }
    settleSpread(next);
    events.push({ type: "showdown" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    return state.phase === "ante" ? { type: "ante", seat, amount: state.config.minBet } : { type: "check", seat };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "red-dog",
      phase: state.phase,
      community: [...state.community],
      spread: state.phase === "ante" ? null : state.spread,
      hands: state.players.map((p) => ({ seat: p.seat, cards: [], ante: p.ante, call: p.raise })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  privateFor() { return null; },

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    return { phase: state.phase, actions: menu.actions, spread: state.spread };
  }
};
