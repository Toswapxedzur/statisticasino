// Seven-Card Stud engine. Antes + a bring-in (no blinds); each player gets 2 down
// + 1 up on 3rd street, one up on 4th/5th/6th, one down on 7th (a shared community
// card if the deck can't cover everyone). The bring-in (lowest up-card) starts 3rd
// street; the highest hand showing starts each later street. Betting is no-limit
// via the shared betting-core. Showdown = best 5 of 7. Up-cards are exposed to the
// runtime via player.upCards (LiveTable shows them to everyone).

import { bestHand, compareRank, STANDARD_MODEL } from "./evaluator.js";
import { RANKS } from "./cards.js";
import {
  orderedPlayers, nextClockwise, contribute, buildPots, activePlayers, nonFolded,
  openBettingRound, bettingActions, applyBettingAction, settlePots, settleUncontested
} from "./betting-core.js";

const STREETS = ["third", "fourth", "fifth", "sixth", "seventh"];
const SUIT_ORDER = { c: 0, d: 1, h: 2, s: 3 }; // bring-in suit tiebreak (clubs lowest)
const clone = (v) => JSON.parse(JSON.stringify(v));
const rv = (c) => RANKS.indexOf(c[0]) + 2;

function takeCards(state, count) {
  const end = state.deckPosition + count;
  const cards = state.deck.slice(state.deckPosition, Math.min(end, state.deck.length));
  state.deckPosition += cards.length;
  return cards;
}

// Comparable value for the cards a player is SHOWING (2–4 up cards): more-of-a-kind
// first, then high cards. Used only to pick who acts first on later streets.
function showingRank(upCards) {
  const counts = new Map();
  for (const c of upCards) counts.set(rv(c), (counts.get(rv(c)) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return groups.flatMap(([rank, n]) => [n, rank]);
}
function cmpArr(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
function highestShowingSeat(state) {
  const contenders = state.players.filter((p) => p.status === "active");
  let best = null;
  for (const p of contenders) {
    if (best === null || cmpArr(showingRank(p.upCards), showingRank(best.upCards)) > 0) best = p;
  }
  return best ? best.seat : null;
}

const evalOf = (state) => (player) => bestHand([...player.holeCards, ...(state.board || [])], STANDARD_MODEL);

function dealUp(state, streetName, events) {
  state.street = streetName;
  for (const p of state.players) {
    if (p.status === "folded") continue;
    const card = takeCards(state, 1)[0];
    if (!card) continue;
    p.holeCards.push(card);
    p.upCards.push(card);
  }
  events.push({ type: "streetDealt", street: streetName });
}

function dealSeventh(state, events) {
  state.street = "seventh";
  const contenders = state.players.filter((p) => p.status !== "folded");
  if (state.deck.length - state.deckPosition >= contenders.length) {
    for (const p of contenders) p.holeCards.push(takeCards(state, 1)[0]); // 7th down, private
  } else {
    const community = takeCards(state, 1)[0]; // deck short → one shared river card
    if (community) state.board.push(community);
  }
  events.push({ type: "streetDealt", street: "seventh" });
}

function dealStreet(state, streetName, events) {
  if (streetName === "seventh") dealSeventh(state, events);
  else dealUp(state, streetName, events);
}

function showdown(state, events) {
  settlePots(state, { evaluate: evalOf(state), compare: compareRank }, events);
}

// After a betting round closes: sole survivor wins; else deal the next street and
// open its betting (highest hand showing first). If ≤1 player can still act, run
// the remaining streets out and go to showdown.
function advance(state, events) {
  if (nonFolded(state).length === 1) { settleUncontested(state, events); return; }
  if (state.street === "seventh") { showdown(state, events); return; }

  const next = STREETS[STREETS.indexOf(state.street) + 1];
  dealStreet(state, next, events);

  if (activePlayers(state).length <= 1) {
    let s = state.street;
    while (s !== "seventh") { const n = STREETS[STREETS.indexOf(s) + 1]; dealStreet(state, n, events); s = n; }
    showdown(state, events);
    return;
  }
  openBettingRound(state, highestShowingSeat(state));
}

export function createHand(config) {
  const variantKey = config.variant || "seven-card-stud";
  const ante = config.smallBlind; // small forced ante per player
  const bringIn = config.smallBlind;
  const players = orderedPlayers(config.players).map((p) => ({
    seat: p.seat, id: p.id, holeCards: [], upCards: [], stack: p.stack,
    committedThisStreet: 0, totalCommitted: 0, status: "active", hasActedThisRound: false, canRaise: true
  }));
  const state = {
    street: "third", variantKey, board: [], buttonSeat: config.buttonSeat,
    smallBlind: config.smallBlind, bigBlind: config.bigBlind, ante,
    minBet: config.bigBlind, bettingStructure: "no-limit",
    players, toActSeat: null, currentBet: 0, minRaise: config.bigBlind,
    lastAggressorSeat: null, pots: [], payouts: [], result: null,
    deck: [...config.deck], deckPosition: 0, initialEvents: []
  };

  for (const p of state.players) if (ante > 0) contribute(p, ante, false); // antes (dead money)

  // Deal 3rd street: two down, one up, clockwise from the button.
  const order = [];
  let cursor = state.buttonSeat;
  for (let i = 0; i < players.length; i += 1) { const p = nextClockwise(players, cursor); order.push(p); cursor = p.seat; }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const p of order) { const card = takeCards(state, 1)[0]; p.holeCards.push(card); if (pass === 2) p.upCards.push(card); }
  }
  state.initialEvents.push({ type: "holeCardsDealt", hands: players.map((p) => ({ seat: p.seat, cards: [...p.holeCards] })) });

  // Bring-in: lowest up-card (rank, then suit c<d<h<s) posts a forced bet.
  let bringInPlayer = players[0];
  for (const p of players) {
    const a = p.upCards[0];
    const b = bringInPlayer.upCards[0];
    if (rv(a) < rv(b) || (rv(a) === rv(b) && SUIT_ORDER[a[1]] < SUIT_ORDER[b[1]])) bringInPlayer = p;
  }
  contribute(bringInPlayer, bringIn);
  state.currentBet = bringIn;
  state.lastAggressorSeat = bringInPlayer.seat;
  for (const p of players) { p.hasActedThisRound = p.status !== "active"; p.canRaise = p.status === "active"; }
  bringInPlayer.hasActedThisRound = true;
  state.initialEvents.push({ type: "bringIn", seat: bringInPlayer.seat, amount: bringIn });
  state.pots = buildPots(players);
  const first = nextClockwise(players, bringInPlayer.seat, (p) => p.status === "active");
  state.toActSeat = first ? first.seat : null;
  return state;
}

export function legalActions(state) {
  if (!state || state.toActSeat === null) return { toActSeat: null, actions: [] };
  return bettingActions(state);
}

export function applyAction(state, action) {
  if (!action || typeof action !== "object") throw new TypeError("action must be an object");
  if (state.toActSeat === null) throw new Error("the hand is not waiting for an action");
  if (action.seat !== state.toActSeat) throw new Error(`it is seat ${state.toActSeat}'s turn`);
  const next = clone(state);
  const { events, closed } = applyBettingAction(next, action);
  if (closed || nonFolded(next).length === 1) advance(next, events);
  return { state: next, events };
}
