// Canonical card helpers shared by the evaluator and Hold'em reducer.
// Cards are always two-character strings: one rank followed by one suit.

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

// Suit-major, rank-minor order: 2c..Ac, 2d..Ad, 2h..Ah, 2s..As.
export function standardDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

// Fisher-Yates over a copy. `rng` is injectable so callers can make
// shuffling deterministic; the poker state machine never calls this.
export function shuffle(deck, rng = Math.random) {
  if (!Array.isArray(deck)) throw new TypeError("deck must be an array");
  if (typeof rng !== "function") throw new TypeError("rng must be a function");

  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("rng must return a number in [0, 1)");
    }
    const j = Math.floor(value * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
