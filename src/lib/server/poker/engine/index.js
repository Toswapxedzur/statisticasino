export { RANKS, SUITS, SHORT_RANKS, standardDeck, shortDeck, shuffle } from "./cards.js";
export { evaluate7, compareRank, bestHand, bestOmaha } from "./evaluator.js";
export { VARIANTS, VARIANT_KEYS, getVariant } from "./variants.js";

// Engine dispatch by variant. LiveTable imports createHand/legalActions/
// applyAction from here, so routing lives here and the runtime needs no changes.
// createHand routes on config.variant; legalActions/applyAction on state.variantKey
// (they receive only the hand state). Everything not listed is a flop-family game
// (Hold'em / Omaha / Short Deck) handled by holdem.js.
import * as holdemEngine from "./holdem.js";
import * as drawEngine from "./draw.js";

const ENGINES = { "five-card-draw": drawEngine };
const engineFor = (variant) => ENGINES[variant] || holdemEngine;

export function createHand(config) { return engineFor(config?.variant).createHand(config); }
export function legalActions(state) { return engineFor(state?.variantKey).legalActions(state); }
export function applyAction(state, action) { return engineFor(state?.variantKey).applyAction(state, action); }

// Node 22 resolves an explicit directory passed to `node --test` to its
// index module instead of discovering sibling test files. Load those files
// only when this directory itself is the test-runner entry point, making the
// documented directory command useful without affecting ordinary imports.
const testTarget = globalThis.process?.argv?.[1] ?? "";
const isDirectoryTestEntry =
  globalThis.process?.env?.NODE_TEST_CONTEXT && /(?:^|[\\/])engine[\\/]?$/.test(testTarget);
if (isDirectoryTestEntry) {
  await Promise.all([
    import("./cards.test.js"),
    import("./evaluator.test.js"),
    import("./holdem.test.js"),
    import("./variants.test.js")
  ]);
}
