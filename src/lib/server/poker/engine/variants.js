// Poker variant descriptors — the data the generic flop engine (holdem.js) reads
// so one betting core serves every Hold'em-family game. A variant is only the
// FIVE things that differ between poker games:
//   deck            which cards (52 vs. short-deck 36)
//   holeCount       cards dealt per player (2 / 4 / 5)
//   boardSchedule   community cards per street (flop games share one schedule)
//   evaluate        showdown hand SELECTION (best-of-7 vs. Omaha's exactly 2+3)
//   compare         rank ordering (short deck floats flushes over full houses)
// plus the betting structure (no-limit vs. pot-limit).
//
// Only the string `key` is stored in hand state (state must stay JSON-cloneable);
// the engine resolves the descriptor — which carries functions — via getVariant().

import { standardDeck, shortDeck } from "./cards.js";
import { bestHand, bestOmaha, bestOmahaLow, compareRank, compareLowRanks, SHORTDECK_MODEL, STANDARD_MODEL } from "./evaluator.js";

const FLOP_BOARD = [
  { street: "flop", deal: 3 },
  { street: "turn", deal: 1 },
  { street: "river", deal: 1 }
];
const FLOP_STREETS = ["preflop", "flop", "turn", "river"];

function flopVariant(spec) {
  return {
    family: "poker",
    boardSchedule: FLOP_BOARD,
    streets: FLOP_STREETS,
    compare: compareRank,
    ...spec
  };
}

export const VARIANTS = {
  holdem: flopVariant({
    key: "holdem", name: "No-Limit Hold'em",
    deck: standardDeck, holeCount: 2, bettingStructure: "no-limit",
    evaluate: (hole, board) => bestHand([...hole, ...board], STANDARD_MODEL)
  }),
  "holdem-pl": flopVariant({
    key: "holdem-pl", name: "Pot-Limit Hold'em",
    deck: standardDeck, holeCount: 2, bettingStructure: "pot-limit",
    evaluate: (hole, board) => bestHand([...hole, ...board], STANDARD_MODEL)
  }),
  plo: flopVariant({
    key: "plo", name: "Pot-Limit Omaha",
    deck: standardDeck, holeCount: 4, bettingStructure: "pot-limit",
    evaluate: (hole, board) => bestOmaha(hole, board, STANDARD_MODEL)
  }),
  plo5: flopVariant({
    key: "plo5", name: "Pot-Limit 5-Card Omaha",
    deck: standardDeck, holeCount: 5, bettingStructure: "pot-limit",
    evaluate: (hole, board) => bestOmaha(hole, board, STANDARD_MODEL)
  }),
  "omaha-hilo": flopVariant({
    key: "omaha-hilo", name: "Pot-Limit Omaha Hi-Lo",
    deck: standardDeck, holeCount: 4, bettingStructure: "pot-limit",
    evaluate: (hole, board) => bestOmaha(hole, board, STANDARD_MODEL),
    // Hi-lo: half the pot to the best 8-or-better low (exactly 2 hole + 3 board).
    // A null return means no qualifying low, so the high hand scoops.
    evaluateLow: (hole, board) => bestOmahaLow(hole, board),
    compareLow: compareLowRanks
  }),
  shortdeck: flopVariant({
    key: "shortdeck", name: "No-Limit Short Deck",
    deck: shortDeck, holeCount: 2, bettingStructure: "no-limit",
    evaluate: (hole, board) => bestHand([...hole, ...board], SHORTDECK_MODEL)
  }),
  "shortdeck-pl": flopVariant({
    key: "shortdeck-pl", name: "Pot-Limit Short Deck",
    deck: shortDeck, holeCount: 2, bettingStructure: "pot-limit",
    evaluate: (hole, board) => bestHand([...hole, ...board], SHORTDECK_MODEL)
  }),
  // Non-flop families: their engine (draw.js, dispatched in index.js) owns dealing
  // + streets. The descriptor exists so getVariant().deck() and the hub's
  // VARIANT_KEYS validation work; boardSchedule/streets are unused here.
  "five-card-draw": {
    key: "five-card-draw", name: "No-Limit Five-Card Draw", family: "poker",
    deck: standardDeck, holeCount: 5, bettingStructure: "no-limit", compare: compareRank,
    // For the bot's equity sim: no community cards, hand = the five hole cards.
    boardSchedule: [], evaluate: (hole, board) => bestHand([...hole, ...(board || [])], STANDARD_MODEL)
  },
  "seven-card-stud": {
    key: "seven-card-stud", name: "Seven-Card Stud", family: "poker",
    deck: standardDeck, holeCount: 7, bettingStructure: "no-limit", compare: compareRank
  }
};

export const VARIANT_KEYS = Object.keys(VARIANTS);

// Resolve a variant key to its descriptor; unknown/undefined → Hold'em, so old
// hand state and callers that omit a variant keep the classic behavior.
export function getVariant(key) {
  return VARIANTS[key] || VARIANTS.holdem;
}
