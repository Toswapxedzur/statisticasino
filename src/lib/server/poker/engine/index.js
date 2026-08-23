export { RANKS, SUITS, SHORT_RANKS, standardDeck, shortDeck, shuffle } from "./cards.js";
export { evaluate7, compareRank, bestHand, bestOmaha } from "./evaluator.js";
export { createHand, legalActions, applyAction } from "./holdem.js";
export { VARIANTS, VARIANT_KEYS, getVariant } from "./variants.js";

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
