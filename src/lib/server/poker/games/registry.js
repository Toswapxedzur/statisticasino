// Registry of pluggable GameModules (the "banked" casino games that run on
// GameTable). Poker runs on LiveTable and isn't here. Adding a game = write its
// module on the toolkit and register it — the hub, lobby and generic banked UI
// pick it up by key. The table's `variant` column stores the game key.

import { blackjack } from "./blackjack.js";
import { casinoHoldem } from "./casino-holdem.js";
import { threeCard } from "./three-card.js";
import { baccarat } from "./baccarat.js";
import { roulette } from "./roulette.js";
import { sicBo } from "./sic-bo.js";
import { dragonTiger } from "./dragon-tiger.js";
import { casinoWar } from "./casino-war.js";
import { andarBahar } from "./andar-bahar.js";
import { moneyWheel } from "./money-wheel.js";
import { caribbeanStud } from "./caribbean-stud.js";
import { redDog } from "./red-dog.js";
import { ultimateHoldem } from "./ultimate-holdem.js";
import { letItRide } from "./let-it-ride.js";
import { videoPoker } from "./video-poker.js";
import { slots } from "./slots.js";
import { keno } from "./keno.js";
import { craps } from "./craps.js";
import { paiGow } from "./pai-gow.js";

export const GAMES = {
  blackjack,
  "casino-holdem": casinoHoldem,
  "three-card": threeCard,
  baccarat,
  roulette,
  "sic-bo": sicBo,
  "dragon-tiger": dragonTiger,
  "casino-war": casinoWar,
  "andar-bahar": andarBahar,
  "money-wheel": moneyWheel,
  "caribbean-stud": caribbeanStud,
  "red-dog": redDog,
  "ultimate-holdem": ultimateHoldem,
  "let-it-ride": letItRide,
  "video-poker": videoPoker,
  slots,
  keno,
  craps,
  "pai-gow": paiGow
};

export const BANKED_GAME_KEYS = Object.keys(GAMES);

export function getGame(key) {
  return GAMES[key] || null;
}
export function isBankedGame(key) {
  return Object.prototype.hasOwnProperty.call(GAMES, key);
}
