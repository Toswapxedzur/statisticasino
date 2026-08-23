// Shared card-game toolkit — the common pieces every card game is built from:
// HOLE cards, COMMUNITY (central) cards, BETS, hand evaluation, and settlement.
// GameModules compose these primitives instead of re-implementing them, so a new
// game is thin (see casino-holdem.js). Pure-chance games (roulette, dice) skip
// the card helpers and just use bankedResults for settlement.

import { standardDeck } from "../engine/cards.js";

// Re-export the one hand evaluator so every card game ranks hands identically.
export { evaluate7, bestHand, bestOmaha, compareRank, STANDARD_MODEL, SHORTDECK_MODEL } from "../engine/evaluator.js";

// A single 52-card deck, or an N-deck shoe. Duplicate card strings are fine for
// value games (blackjack); use 1 deck for games whose evaluator needs uniqueness.
export function shoe(decks = 1) {
  const one = standardDeck();
  if (decks <= 1) return one;
  const out = [];
  for (let i = 0; i < decks; i += 1) out.push(...one);
  return out;
}

// Draw n cards from a round state carrying { deck, deckPos }.
export function take(state, n) {
  const end = state.deckPos + n;
  if (end > state.deck.length) throw new RangeError("deck exhausted");
  const cards = state.deck.slice(state.deckPos, end);
  state.deckPos = end;
  return cards;
}

// Deal `count` hole cards to each player (players carry a `cards` array), one at
// a time in seat order — the standard dealing pattern.
export function dealHole(state, players, count) {
  for (let pass = 0; pass < count; pass += 1) {
    for (const p of players) p.cards.push(take(state, 1)[0]);
  }
}

// Add `count` cards to the shared board (state.community), returning the new ones.
export function dealCommunity(state, count) {
  const cards = take(state, count);
  state.community.push(...cards);
  return cards;
}

// Banked settlement: given each player's chip delta, append the banker's
// offsetting delta so the round sums to zero (the house absorbs the net). This is
// the settlement half of every "vs the house" game.
export function bankedResults(playerResults, bankerSeat) {
  let bankerDelta = 0;
  for (const r of playerResults) bankerDelta -= r.delta;
  return [...playerResults, { seat: bankerSeat, delta: bankerDelta, outcome: "banker" }];
}

// Clamp a bet to a [min, max] integer range (shared bet-validation helper).
export function clampBet(amount, min, max) {
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
