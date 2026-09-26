// Registry of pluggable GameModules (the "banked" casino games that run on
// GameTable). Poker runs on LiveTable and isn't here. Adding a game = write its
// module on the toolkit and register it — the hub, lobby and generic banked UI
// pick it up by key. The table's `variant` column stores the game key.

import { blackjack } from "./blackjack.js";
import { threeCard } from "./three-card.js";
import { baccarat } from "./baccarat.js";
import { roulette } from "./roulette.js";
import { sicBo } from "./sic-bo.js";
import { slots } from "./slots.js";
import { bigTwo } from "./big-two.js";

// The games the site offers (owner, 2026-09-26: one per major type; the other house and shedding
// games were deleted — git history keeps them).
export const GAMES = {
  blackjack,
  "three-card": threeCard,
  baccarat,
  roulette,
  "sic-bo": sicBo,
  slots,
  // Shedding games run on GameTable too, but with usesBanker:false (no house).
  "big-two": bigTwo
};

export const BANKED_GAME_KEYS = Object.keys(GAMES);

export function getGame(key) {
  return GAMES[key] || null;
}
export function isBankedGame(key) {
  return Object.prototype.hasOwnProperty.call(GAMES, key);
}
