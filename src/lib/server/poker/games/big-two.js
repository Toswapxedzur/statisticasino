// Big Two (Choh Dai Di / 大老二) — a SHEDDING game for chips. Deal 13 each; the
// holder of the lowest card leads and must include it. On your turn play a combo
// that BEATS the current one (same size, higher) or pass; when everyone else
// passes, the last player to play leads a fresh round with anything. First to shed
// all cards takes the pot. Singles/pairs/triples rank with 2 high (then suit);
// 5-card hands use the poker evaluator (straight < flush < full house < quads <
// straight flush). Player-vs-player, no house (GameTable, usesBanker:false).

import { shoe, bestHand, compareRank, STANDARD_MODEL } from "./toolkit.js";

const DEFAULTS = { minBet: 1, handSize: 13 };
const RVAL = { "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14, "2": 15 };
const SVAL = { d: 0, c: 1, h: 2, s: 3 };
const cardKey = (c) => RVAL[c[0]] * 4 + SVAL[c[1]];
const clone = (v) => JSON.parse(JSON.stringify(v));

// A play is 1/2/3 same-rank cards, or a 5-card poker hand (straight+). Returns a
// comparable descriptor, or null if the cards aren't a legal combo.
function classifyPlay(cards) {
  const n = cards.length;
  if (n === 1) return { size: 1, key: cardKey(cards[0]) };
  if (n === 2) return RVAL[cards[0][0]] === RVAL[cards[1][0]] ? { size: 2, key: Math.max(cardKey(cards[0]), cardKey(cards[1])) } : null;
  if (n === 3) { const r = RVAL[cards[0][0]]; return cards.every((c) => RVAL[c[0]] === r) ? { size: 3, key: r } : null; }
  if (n === 5) { const rank = bestHand(cards, STANDARD_MODEL); return rank.category >= 4 ? { size: 5, rank } : null; }
  return null;
}
// >0 if a beats b (same size only).
function comparePlay(a, b) {
  if (a.size !== b.size) return null;
  return a.size === 5 ? compareRank(a.rank, b.rank) : a.key - b.key;
}

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function nextSeat(state, afterSeat) {
  const active = order(state).filter((seat) => !state.players.find((p) => p.seat === seat).done);
  if (!active.length) return null;
  const after = active.filter((s) => s > afterSeat);
  return (after.length ? after : active)[0];
}
const activeCount = (state) => state.players.filter((p) => !p.done).length;

function finish(state, winnerSeat) {
  const pot = state.players.reduce((s, p) => s + p.ante, 0);
  state.winner = winnerSeat;
  state.results = state.players.map((p) => ({ seat: p.seat, delta: p.seat === winnerSeat ? pot - p.ante : -p.ante, outcome: p.seat === winnerSeat ? "win" : "lose" }));
  state.phase = "complete";
  state.toActSeat = null;
}

export const bigTwo = {
  key: "big-two",
  name: "Big Two",
  family: "shedding",
  usesBanker: false,
  minPlayers: 2,
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "big-two", phase: "play", config,
      deck: [...ctx.deck], deckPos: 0, pile: null, pilePlayer: null, lastPlayerSeat: null, passStreak: 0, opened: false,
      players: ctx.players.map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, hand: [], done: false, ante: config.minBet })),
      toActSeat: null, winner: null, results: null
    };
    if (state.players.length < 2) { state.phase = "complete"; state.results = []; return state; }
    for (let i = 0; i < config.handSize; i += 1) for (const p of state.players) p.hand.push(state.deck[state.deckPos++]);
    // Lowest card in play leads and must include it on the opening play.
    let lead = state.players[0];
    let lowKey = Infinity;
    for (const p of state.players) for (const c of p.hand) { const k = cardKey(c); if (k < lowKey) { lowKey = k; lead = p; } }
    state.lowestCard = lead.hand.reduce((lo, c) => (cardKey(c) < cardKey(lo) ? c : lo), lead.hand[0]);
    state.toActSeat = lead.seat;
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    // Can't pass when you hold the lead (nothing to beat).
    return { toActSeat: state.toActSeat, actions: state.pile ? [{ type: "play" }, { type: "pass" }] : [{ type: "play" }] };
  },

  applyAction(state, action) {
    const next = clone(state);
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const events = [];

    if (action.type === "pass") {
      if (!next.pile) throw new RangeError("cannot pass on the lead");
      next.passStreak += 1;
      if (next.passStreak >= activeCount(next) - 1) { // everyone else passed → last player leads fresh
        next.pile = null;
        next.passStreak = 0;
        next.toActSeat = next.lastPlayerSeat;
      } else {
        next.toActSeat = nextSeat(next, p.seat);
      }
      events.push({ type: "pass", seat: p.seat });
      return { state: next, events };
    }

    if (action.type !== "play") throw new RangeError(`illegal action: ${action.type}`);
    const cards = Array.isArray(action.cards) ? action.cards : [];
    if (!cards.length || !cards.every((c) => p.hand.includes(c)) || new Set(cards).size !== cards.length) throw new RangeError("invalid card selection");
    const play = classifyPlay(cards);
    if (!play) throw new RangeError("not a legal combo");
    if (next.pile) {
      if (play.size !== next.pile.size) throw new RangeError("must match the number of cards in play");
      if (comparePlay(play, next.pile) <= 0) throw new RangeError("must beat the current play");
    } else if (!next.opened) {
      if (!cards.includes(next.lowestCard)) throw new RangeError(`the opening play must include ${next.lowestCard}`);
    }

    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    next.pile = { cards: [...cards], size: play.size };
    next.pilePlayer = p.seat;
    next.lastPlayerSeat = p.seat;
    next.passStreak = 0;
    next.opened = true;
    events.push({ type: "play", seat: p.seat, cards });
    if (p.hand.length === 0) { finish(next, p.seat); return { state: next, events }; }
    next.toActSeat = nextSeat(next, p.seat);
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    // Timeout: pass if allowed, else lead the single lowest card.
    if (state.pile) return { type: "pass", seat };
    const p = state.players.find((x) => x.seat === seat);
    const low = p.hand.reduce((lo, c) => (cardKey(c) < cardKey(lo) ? c : lo), p.hand[0]);
    const card = state.opened ? low : state.lowestCard;
    return { type: "play", seat, cards: [card] };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "big-two",
      shedGame: true,
      phase: state.phase,
      pile: state.pile ? [...state.pile.cards] : [],
      pilePlayer: state.pilePlayer,
      players: state.players.map((p) => ({ seat: p.seat, cardCount: p.hand.length, done: p.done })),
      toActSeat: state.toActSeat,
      winner: state.winner,
      results: state.results
    };
  },

  privateFor(state, seat) {
    const p = state.players.find((x) => x.seat === seat);
    return p ? { holeCards: [...p.hand] } : null;
  },

  turnInfo(state, seat) {
    if (state.toActSeat !== seat) return null;
    const p = state.players.find((x) => x.seat === seat);
    return {
      shedGame: true, combo: true, hand: [...p.hand],
      canPass: !!state.pile, pileSize: state.pile ? state.pile.size : 0,
      pileCards: state.pile ? [...state.pile.cards] : [],
      mustInclude: !state.opened ? state.lowestCard : null
    };
  }
};

export { classifyPlay, comparePlay, cardKey }; // for tests
