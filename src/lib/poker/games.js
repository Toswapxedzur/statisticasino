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
  { key: "pai-gow", label: "Pai Gow Poker" },
  { key: "crazy-eights", label: "Crazy Eights" },
  { key: "big-two", label: "Big Two" }
];

// Banked (vs-the-house) games — keep in sync with games/registry.js.
export const BANKED_GAMES = [
  "blackjack", "casino-holdem", "three-card", "baccarat", "roulette", "sic-bo",
  "dragon-tiger", "casino-war", "andar-bahar", "money-wheel",
  "caribbean-stud", "red-dog", "ultimate-holdem", "let-it-ride", "video-poker", "slots", "keno", "craps", "pai-gow"
];
export function isBanked(key) { return BANKED_GAMES.includes(key); }

// Shedding games (player-vs-player card play for chips; no house). Run on
// GameTable with usesBanker:false — keep in sync with games/registry.js.
export const SHEDDING_GAMES = ["crazy-eights", "big-two"];
export function isShedding(key) { return SHEDDING_GAMES.includes(key); }

// Poker variants offered in the New Table modal, grouped for a tidy picker.
export const POKER_VARIANTS = [
  { key: "holdem", label: "No-Limit Hold'em", short: "NL Hold'em" },
  { key: "holdem-pl", label: "Pot-Limit Hold'em", short: "PL Hold'em" },
  { key: "plo", label: "Pot-Limit Omaha", short: "PLO" },
  { key: "plo5", label: "5-Card PLO", short: "5-Card PLO" },
  { key: "omaha-hilo", label: "Pot-Limit Omaha Hi-Lo", short: "PLO Hi-Lo" },
  { key: "shortdeck", label: "No-Limit Short Deck", short: "NL Short Deck" },
  { key: "shortdeck-pl", label: "Pot-Limit Short Deck", short: "PL Short Deck" },
  { key: "five-card-draw", label: "No-Limit Five-Card Draw", short: "5-Card Draw" },
  { key: "seven-card-stud", label: "Seven-Card Stud", short: "7-Card Stud" }
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
  ["pai-gow", "Pai Gow Poker"],
  ["crazy-eights", "Crazy Eights"],
  ["big-two", "Big Two"]
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
  ["pai-gow", "Pai Gow Poker"],
  ["crazy-eights", "Crazy Eights"],
  ["big-two", "Big Two"]
]);

// The games the site OFFERS (owner, 2026-09-26: one game per major type, 8 of 30). The rest are
// hidden — no lobby tab, no New table choice, and the server refuses to create them — but their
// engines, labels and replays stay, so any mode can come back by adding its key here.
//   community-card poker: Hold'em · blackjack · baccarat family: Baccarat · poker vs the house:
//   Three Card Poker · wheel: Roulette · dice: Sic Bo · machines: Slots · shedding: Big Two
export const OFFERED = new Set(["holdem", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots", "big-two"]);
export function isOffered(key) { return OFFERED.has(key); }
/** The lobby's mode tabs, in the lobby's order (player-vs-player first, then the house games), each
 *  with a short tab label (poker = its offered variants). */
const LOBBY_ORDER = ["poker", "big-two", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"];
const TAB_LABEL = { poker: "Hold'em", "three-card": "Three Card" };
export const LOBBY_MODES = LOBBY_ORDER
  .map((key) => GAME_MODES.find((m) => m.key === key))
  .filter((m) => m && (m.key === "poker" ? POKER_VARIANTS.some((v) => OFFERED.has(v.key)) : OFFERED.has(m.key)))
  .map((m) => ({ ...m, tab: TAB_LABEL[m.key] || m.label }));

/** The game's icon (static/games, drawn in design/game-icons) for a variant or a mode key, or null
 *  for a game without one. Every poker variant shows the Hold'em chips. */
const ICON_KEYS = new Set(["holdem", "big-two", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"]);
export function gameIcon(key) {
  const k = key === "poker" || modeOf(key) === "poker" ? "holdem" : key;
  return ICON_KEYS.has(k) ? `/games/${k}.svg` : null;
}
/** The poker variants the New table picker shows. */
export const OFFERED_POKER_VARIANTS = POKER_VARIANTS.filter((v) => OFFERED.has(v.key));

export function variantShort(key) {
  return SHORT_BY_KEY.get(key) || "NL Hold'em";
}
export function variantLabel(key) {
  return LABEL_BY_KEY.get(key) || "No-Limit Hold'em";
}
// The game mode a table belongs to: a banked or shedding game is its own mode;
// any poker variant maps to "poker".
export function modeOf(variant) {
  return isBanked(variant) || isShedding(variant) ? variant : "poker";
}
