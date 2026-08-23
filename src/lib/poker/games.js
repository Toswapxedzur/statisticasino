// Client-safe catalog of game modes + poker variants (labels only, no engine
// code — components can't import from $lib/server). Keep the keys in sync with
// engine/variants.js (VARIANTS) and games/blackjack.js.

export const GAME_MODES = [
  { key: "poker", label: "Poker" },
  { key: "blackjack", label: "Blackjack" },
  { key: "casino-holdem", label: "Casino Hold'em" }
];

// Banked (vs-the-house) games — keep in sync with games/registry.js.
export const BANKED_GAMES = ["blackjack", "casino-holdem"];
export function isBanked(key) { return BANKED_GAMES.includes(key); }

// Poker variants offered in the New Table modal, grouped for a tidy picker.
export const POKER_VARIANTS = [
  { key: "holdem", label: "No-Limit Hold'em", short: "NL Hold'em" },
  { key: "holdem-pl", label: "Pot-Limit Hold'em", short: "PL Hold'em" },
  { key: "plo", label: "Pot-Limit Omaha", short: "PLO" },
  { key: "plo5", label: "5-Card PLO", short: "5-Card PLO" },
  { key: "shortdeck", label: "No-Limit Short Deck", short: "NL Short Deck" },
  { key: "shortdeck-pl", label: "Pot-Limit Short Deck", short: "PL Short Deck" }
];

const SHORT_BY_KEY = new Map([
  ...POKER_VARIANTS.map((v) => [v.key, v.short]),
  ["blackjack", "Blackjack"],
  ["casino-holdem", "Casino Hold'em"]
]);
const LABEL_BY_KEY = new Map([
  ...POKER_VARIANTS.map((v) => [v.key, v.label]),
  ["blackjack", "Blackjack"],
  ["casino-holdem", "Casino Hold'em"]
]);

export function variantShort(key) {
  return SHORT_BY_KEY.get(key) || "NL Hold'em";
}
export function variantLabel(key) {
  return LABEL_BY_KEY.get(key) || "No-Limit Hold'em";
}
// The game mode a table belongs to: a banked game is its own mode; any poker
// variant maps to "poker".
export function modeOf(variant) {
  return isBanked(variant) ? variant : "poker";
}
