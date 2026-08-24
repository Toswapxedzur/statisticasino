// Five-Card Draw engine. Blinds + five hole cards, a betting round, ONE draw
// (each player discards 0–5 and redraws), a second betting round, showdown on the
// best 5-card hand. Exposes the same createHand / legalActions / applyAction
// interface as holdem.js so LiveTable can drive it the same way. Betting reuses
// the shared betting-core; only the deal + street/draw progression live here.

import { bestHand, compareRank, STANDARD_MODEL } from "./evaluator.js";
import { standardDeck } from "./cards.js";
import {
  orderedPlayers, nextClockwise, contribute, buildPots, activePlayers, nonFolded,
  openBettingRound, bettingActions, applyBettingAction, settlePots, settleUncontested
} from "./betting-core.js";

const STREETS = ["predraw", "draw", "postdraw"];
const clone = (v) => JSON.parse(JSON.stringify(v));

function takeCards(state, count) {
  // Reshuffle the muck back into the stub (deterministic) if the stub runs dry.
  if (state.deckPosition + count > state.deck.length && state.muck.length) {
    state.deck = [...state.deck.slice(state.deckPosition), ...state.muck];
    state.muck = [];
    state.deckPosition = 0;
  }
  const end = state.deckPosition + count;
  const cards = state.deck.slice(state.deckPosition, Math.min(end, state.deck.length));
  state.deckPosition += cards.length;
  return cards;
}

const evaluate = (player) => bestHand(player.holeCards, STANDARD_MODEL);

// After a betting round closes: sole survivor wins; else go predraw→draw→postdraw
// →showdown, skipping the postdraw betting when ≤1 player can still act.
function advance(state, events) {
  if (nonFolded(state).length === 1) { settleUncontested(state, events); return; }

  if (state.street === "predraw") {
    state.street = "draw";
    for (const p of state.players) p.hasDrawn = p.status === "folded";
    const first = nextClockwise(state.players, state.buttonSeat, (p) => !p.hasDrawn);
    state.toActSeat = first ? first.seat : null;
    if (state.toActSeat === null) finishDraw(state, events);
    return;
  }
  // postdraw betting closed → showdown
  settlePots(state, { evaluate, compare: compareRank }, events);
}

function finishDraw(state, events) {
  events.push({ type: "drawComplete" });
  if (activePlayers(state).length <= 1) { settlePots(state, { evaluate, compare: compareRank }, events); return; }
  state.street = "postdraw";
  const first = nextClockwise(state.players, state.buttonSeat, (p) => p.status === "active");
  openBettingRound(state, first ? first.seat : null);
}

export function createHand(config) {
  const variantKey = config.variant || "five-card-draw";
  const players = orderedPlayers(config.players).map((p) => ({
    seat: p.seat, id: p.id, holeCards: [], stack: p.stack,
    committedThisStreet: 0, totalCommitted: 0, status: "active", hasActedThisRound: false, canRaise: true, hasDrawn: false
  }));
  const state = {
    street: "predraw", variantKey, board: [], buttonSeat: config.buttonSeat,
    smallBlind: config.smallBlind, bigBlind: config.bigBlind, ante: config.ante ?? 0,
    minBet: config.bigBlind, bettingStructure: "no-limit",
    players, toActSeat: null, currentBet: config.bigBlind, minRaise: config.bigBlind,
    lastAggressorSeat: null, pots: [], payouts: [], result: null,
    deck: [...config.deck], deckPosition: 0, muck: [], initialEvents: []
  };

  if (state.ante > 0) for (const p of state.players) contribute(p, state.ante, false);

  let sb;
  let bb;
  if (players.length === 2) { sb = players.find((p) => p.seat === state.buttonSeat); bb = nextClockwise(players, state.buttonSeat); }
  else { sb = nextClockwise(players, state.buttonSeat); bb = nextClockwise(players, sb.seat); }
  contribute(sb, state.smallBlind);
  contribute(bb, state.bigBlind);
  state.initialEvents.push({ type: "blindsPosted", smallBlind: { seat: sb.seat, amount: state.smallBlind }, bigBlind: { seat: bb.seat, amount: state.bigBlind } });

  const order = [];
  let cursor = state.buttonSeat;
  for (let i = 0; i < players.length; i += 1) { const p = nextClockwise(players, cursor); order.push(p); cursor = p.seat; }
  for (let pass = 0; pass < 5; pass += 1) for (const p of order) p.holeCards.push(takeCards(state, 1)[0]);
  state.initialEvents.push({ type: "holeCardsDealt", hands: players.map((p) => ({ seat: p.seat, cards: [...p.holeCards] })) });

  for (const p of players) { p.hasActedThisRound = p.status !== "active"; p.canRaise = p.status === "active"; }
  state.pots = buildPots(players);
  const first = nextClockwise(players, bb.seat, (p) => p.status === "active");
  state.toActSeat = first ? first.seat : null;
  return state;
}

export function legalActions(state) {
  if (!state || state.toActSeat === null) return { toActSeat: null, actions: [] };
  if (state.street === "draw") return { toActSeat: state.toActSeat, actions: [{ type: "draw", maxDiscards: 5 }] };
  if (state.street === "predraw" || state.street === "postdraw") return bettingActions(state);
  return { toActSeat: null, actions: [] };
}

export function applyAction(state, action) {
  if (!action || typeof action !== "object") throw new TypeError("action must be an object");
  if (state.toActSeat === null) throw new Error("the hand is not waiting for an action");
  if (action.seat !== state.toActSeat) throw new Error(`it is seat ${state.toActSeat}'s turn`);
  const next = clone(state);

  if (next.street === "draw") {
    // Any non-draw action (a timeout-fold, a check) is treated as standing pat.
    const player = next.players.find((p) => p.seat === action.seat);
    const rawDiscards = action.type === "draw" && Array.isArray(action.discards) ? action.discards : [];
    const discards = [...new Set(rawDiscards.map((n) => Math.floor(Number(n))))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < player.holeCards.length)
      .slice(0, 5);
    const removed = discards.map((i) => player.holeCards[i]);
    next.muck.push(...removed);
    const replacements = takeCards(next, discards.length);
    discards.forEach((idx, k) => { if (replacements[k]) player.holeCards[idx] = replacements[k]; });
    player.hasDrawn = true;
    const events = [{ type: "draw", seat: player.seat, count: discards.length }];
    const nextDrawer = nextClockwise(next.players, player.seat, (p) => !p.hasDrawn);
    if (nextDrawer) next.toActSeat = nextDrawer.seat;
    else finishDraw(next, events);
    return { state: next, events };
  }

  const { events, closed } = applyBettingAction(next, action);
  if (closed || nonFolded(next).length === 1) advance(next, events);
  return { state: next, events };
}
