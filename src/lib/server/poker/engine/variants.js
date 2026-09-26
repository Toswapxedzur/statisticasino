// The poker variant descriptor — the data the flop engine (holdem.js) reads: the deck, the hole
// cards per player, the board per street, the showdown evaluation and the rank ordering. Only
// No-Limit Hold'em remains (the other variants were deleted 2026-09-26); the descriptor stays so the
// engine keeps reading its rules as data.
//
// Only the string `key` is stored in hand state (state must stay JSON-cloneable);
// the engine resolves the descriptor — which carries functions — via getVariant().

import { standardDeck } from "./cards.js";
import { bestHand, compareRank, STANDARD_MODEL } from "./evaluator.js";

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
    deck: standardDeck, holeCount: 2,
    evaluate: (hole, board) => bestHand([...hole, ...board], STANDARD_MODEL)
  })
  // (Omaha, Short Deck, Pot-Limit, Draw and Stud were deleted 2026-09-26 with the other hidden
  // games — git history keeps them.)
};

export const VARIANT_KEYS = Object.keys(VARIANTS);

// Resolve a variant key to its descriptor; unknown/undefined → Hold'em, so old
// hand state and callers that omit a variant keep the classic behavior.
export function getVariant(key) {
  return VARIANTS[key] || VARIANTS.holdem;
}
