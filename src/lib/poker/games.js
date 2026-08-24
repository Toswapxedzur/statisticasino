// Client-safe catalog of game modes + poker variants (labels only, no engine
// code — components can't import from $lib/server). Keep the keys in sync with
// engine/variants.js (VARIANTS) and games/blackjack.js.

export const GAME_MODES = [
  { key: "poker", label: "Poker" },
  { key: "blackjack", label: "Blackjack" },
  { key: "casino-holdem", label: "Casino Hold'em" },
  { key: "three-card", label: "Three Card Poker" },
  { key: "baccarat", label: "Baccarat" },
  { key: "roulette", label: "Roulette" },
  { key: "sic-bo", label: "Sic Bo" },
  { key: "dragon-tiger", label: "Dragon Tiger" },
  { key: "casino-war", label: "Casino War" },
  { key: "andar-bahar", label: "Andar Bahar" },
  { key: "money-wheel", label: "Money Wheel" },
  { key: "caribbean-stud", label: "Caribbean Stud" },
  { key: "red-dog", label: "Red Dog" },
  { key: "ultimate-holdem", label: "Ultimate Texas Hold'em" },
  { key: "let-it-ride", label: "Let It Ride" },
  { key: "video-poker", label: "Video Poker" },
  { key: "slots", label: "Slots" },
  { key: "keno", label: "Keno" },
  { key: "craps", label: "Craps" },
  { key: "pai-gow", label: "Pai Gow Poker" }
];

// Banked (vs-the-house) games — keep in sync with games/registry.js.
export const BANKED_GAMES = [
  "blackjack", "casino-holdem", "three-card", "baccarat", "roulette", "sic-bo",
  "dragon-tiger", "casino-war", "andar-bahar", "money-wheel",
  "caribbean-stud", "red-dog", "ultimate-holdem", "let-it-ride", "video-poker", "slots", "keno", "craps", "pai-gow"
];
export function isBanked(key) { return BANKED_GAMES.includes(key); }

// Poker variants offered in the New Table modal, grouped for a tidy picker.
export const POKER_VARIANTS = [
  { key: "holdem", label: "No-Limit Hold'em", short: "NL Hold'em" },
  { key: "holdem-pl", label: "Pot-Limit Hold'em", short: "PL Hold'em" },
  { key: "plo", label: "Pot-Limit Omaha", short: "PLO" },
  { key: "plo5", label: "5-Card PLO", short: "5-Card PLO" },
  { key: "omaha-hilo", label: "Pot-Limit Omaha Hi-Lo", short: "PLO Hi-Lo" },
  { key: "shortdeck", label: "No-Limit Short Deck", short: "NL Short Deck" },
  { key: "shortdeck-pl", label: "Pot-Limit Short Deck", short: "PL Short Deck" },
  { key: "five-card-draw", label: "No-Limit Five-Card Draw", short: "5-Card Draw" }
];

const SHORT_BY_KEY = new Map([
  ...POKER_VARIANTS.map((v) => [v.key, v.short]),
  ["blackjack", "Blackjack"],
  ["casino-holdem", "Casino Hold'em"],
  ["three-card", "Three Card Poker"],
  ["baccarat", "Baccarat"],
  ["roulette", "Roulette"],
  ["sic-bo", "Sic Bo"],
  ["dragon-tiger", "Dragon Tiger"],
  ["casino-war", "Casino War"],
  ["andar-bahar", "Andar Bahar"],
  ["money-wheel", "Money Wheel"],
  ["caribbean-stud", "Caribbean Stud"],
  ["red-dog", "Red Dog"],
  ["ultimate-holdem", "Ultimate Texas Hold'em"],
  ["let-it-ride", "Let It Ride"],
  ["video-poker", "Video Poker"],
  ["slots", "Slots"],
  ["keno", "Keno"],
  ["craps", "Craps"],
  ["pai-gow", "Pai Gow Poker"]
]);
const LABEL_BY_KEY = new Map([
  ...POKER_VARIANTS.map((v) => [v.key, v.label]),
  ["blackjack", "Blackjack"],
  ["casino-holdem", "Casino Hold'em"],
  ["three-card", "Three Card Poker"],
  ["baccarat", "Baccarat"],
  ["roulette", "Roulette"],
  ["sic-bo", "Sic Bo"],
  ["dragon-tiger", "Dragon Tiger"],
  ["casino-war", "Casino War"],
  ["andar-bahar", "Andar Bahar"],
  ["money-wheel", "Money Wheel"],
  ["caribbean-stud", "Caribbean Stud"],
  ["red-dog", "Red Dog"],
  ["ultimate-holdem", "Ultimate Texas Hold'em"],
  ["let-it-ride", "Let It Ride"],
  ["video-poker", "Video Poker"],
  ["slots", "Slots"],
  ["keno", "Keno"],
  ["craps", "Craps"],
  ["pai-gow", "Pai Gow Poker"]
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
