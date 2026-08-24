// Crazy Eights — a SHEDDING game (empty your hand to win), played for chips: every
// player antes, and the first to shed all their cards takes the pot. Player-vs-
// player with no house, so it runs on GameTable with usesBanker:false. Play a card
// matching the top card's rank or the current suit; 8s are wild (declare a suit);
// if you can't play, draw one and, if it's playable, you may play it, else your
// turn passes. Hands are private; only counts are public.

import { shoe } from "./toolkit.js";

const DEFAULTS = { minBet: 1, handSize: 5 };
const SUITS = new Set(["c", "d", "h", "s"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const isEight = (c) => c[0] === "8";
const playable = (card, top, suit) => isEight(card) || card[0] === top[0] || card[1] === suit;

const order = (state) => state.players.map((p) => p.seat).sort((a, b) => a - b);
function nextSeat(state, afterSeat) {
  const active = order(state).filter((seat) => !state.players.find((p) => p.seat === seat).done);
  if (!active.length) return null;
  const after = active.filter((s) => s > afterSeat);
  return (after.length ? after : active)[0];
}
const activeCount = (state) => state.players.filter((p) => !p.done).length;

function drawCard(state) {
  if (state.deckPos >= state.deck.length) {
    if (state.discard.length <= 1) return null; // nothing to recycle
    const top = state.discard[state.discard.length - 1];
    state.deck = state.discard.slice(0, -1).reverse();
    state.discard = [top];
    state.deckPos = 0;
  }
  return state.deck[state.deckPos++] ?? null;
}

function bestSuit(hand) {
  const counts = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand) if (!isEight(c)) counts[c[1]] += 1;
  return ["s", "h", "d", "c"].reduce((a, b) => (counts[b] > counts[a] ? b : a), "s");
}

function finish(state, winnerSeat) {
  const pot = state.players.reduce((s, p) => s + p.ante, 0);
  state.winner = winnerSeat;
  state.results = state.players.map((p) => ({
    seat: p.seat,
    delta: p.seat === winnerSeat ? pot - p.ante : -p.ante,
    outcome: p.seat === winnerSeat ? "win" : "lose"
  }));
  state.phase = "complete";
  state.toActSeat = null;
}

const fewestCardsSeat = (state) => [...state.players].sort((a, b) => a.hand.length - b.hand.length || a.seat - b.seat)[0].seat;

export const crazyEights = {
  key: "crazy-eights",
  name: "Crazy Eights",
  family: "shedding",
  usesBanker: false,
  minPlayers: 2,
  deck: () => shoe(1),

  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "crazy-eights", phase: "play", config,
      deck: [...ctx.deck], deckPos: 0, discard: [], currentSuit: null, passStreak: 0,
      players: ctx.players.map((p) => ({ seat: p.seat, userId: p.userId, startStack: p.stack, hand: [], done: false, ante: config.minBet })),
      toActSeat: null, winner: null, results: null
    };
    if (state.players.length < 2) { state.phase = "complete"; state.results = []; return state; }
    for (let i = 0; i < config.handSize; i += 1) for (const p of state.players) p.hand.push(state.deck[state.deckPos++]);
    const top = state.deck[state.deckPos++];
    state.discard.push(top);
    state.currentSuit = top[1];
    state.toActSeat = order(state)[0];
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    const p = state.players.find((x) => x.seat === state.toActSeat);
    if (!p) return { toActSeat: null, actions: [] };
    const top = state.discard[state.discard.length - 1];
    const hasPlay = p.hand.some((c) => playable(c, top, state.currentSuit));
    return { toActSeat: state.toActSeat, actions: hasPlay ? [{ type: "play" }] : [{ type: "draw" }] };
  },

  applyAction(state, action) {
    const next = clone(state);
    const p = next.players.find((x) => x.seat === action.seat);
    if (!p || next.toActSeat !== action.seat) throw new Error("not this seat's turn");
    const top = next.discard[next.discard.length - 1];
    const events = [];

    if (action.type === "play") {
      const card = action.card;
      if (!p.hand.includes(card)) throw new RangeError("card not in hand");
      if (!playable(card, top, next.currentSuit)) throw new RangeError("card not playable");
      p.hand.splice(p.hand.indexOf(card), 1);
      next.discard.push(card);
      next.currentSuit = isEight(card) ? (SUITS.has(action.suit) ? action.suit : card[1]) : card[1];
      next.passStreak = 0;
      events.push({ type: "play", seat: p.seat, card });
      if (p.hand.length === 0) { finish(next, p.seat); return { state: next, events }; }
      next.toActSeat = nextSeat(next, p.seat);
      return { state: next, events };
    }

    if (action.type === "draw") {
      const card = drawCard(next);
      if (card) {
        p.hand.push(card);
        events.push({ type: "draw", seat: p.seat });
        if (playable(card, top, next.currentSuit)) { next.passStreak = 0; next.toActSeat = p.seat; return { state: next, events }; }
      }
      next.passStreak += 1;
      if (next.passStreak >= activeCount(next)) { finish(next, fewestCardsSeat(next)); return { state: next, events }; } // everyone stuck
      next.toActSeat = nextSeat(next, p.seat);
      return { state: next, events };
    }
    throw new RangeError(`illegal action: ${action.type}`);
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },
  defaultAction(state, seat) {
    const p = state.players.find((x) => x.seat === seat);
    const top = state.discard[state.discard.length - 1];
    const card = p.hand.find((c) => playable(c, top, state.currentSuit));
    if (card) return { type: "play", seat, card, suit: isEight(card) ? bestSuit(p.hand) : undefined };
    return { type: "draw", seat };
  },
  settle(state) { return state.results || []; },

  publicView(state) {
    return {
      game: "crazy-eights",
      shedGame: true,
      phase: state.phase,
      top: state.discard[state.discard.length - 1] || null,
      currentSuit: state.currentSuit,
      drawCount: Math.max(0, state.deck.length - state.deckPos),
      players: state.players.map((p) => ({ seat: p.seat, cardCount: p.hand.length, done: p.done })),
      toActSeat: state.toActSeat,
      winner: state.winner,
      results: state.results
    };
  },

  privateFor(state, seat) {
    // Reuse the client/bot private-frame plumbing (keyed on holeCards).
    const p = state.players.find((x) => x.seat === seat);
    return p ? { holeCards: [...p.hand] } : null;
  },

  turnInfo(state, seat) {
    if (state.toActSeat !== seat) return null;
    const p = state.players.find((x) => x.seat === seat);
    const top = state.discard[state.discard.length - 1];
    const legal = p.hand.filter((c) => playable(c, top, state.currentSuit));
    return { shedGame: true, hand: [...p.hand], legal, canDraw: legal.length === 0, top, currentSuit: state.currentSuit };
  }
};
