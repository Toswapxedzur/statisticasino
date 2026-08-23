// European (single-zero) Roulette as a bet-selection game. The "deck" is the 37
// pockets 0–36; GameTable shuffles it with its seeded RNG and we take the top
// one as the winning pocket. Players stake on outside bets (red/black, even/odd,
// low/high, dozens, columns — all lose on 0) and straight-up numbers (35:1).

import { bankedBetGame } from "./bet-game.js";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

const OUTSIDE = [
  { key: "red", label: "Red", payout: "1:1", pays: 1, hit: (n, c) => c === "red" },
  { key: "black", label: "Black", payout: "1:1", pays: 1, hit: (n, c) => c === "black" },
  { key: "even", label: "Even", payout: "1:1", pays: 1, hit: (n) => n % 2 === 0 },
  { key: "odd", label: "Odd", payout: "1:1", pays: 1, hit: (n) => n % 2 === 1 },
  { key: "low", label: "1–18", payout: "1:1", pays: 1, hit: (n) => n >= 1 && n <= 18 },
  { key: "high", label: "19–36", payout: "1:1", pays: 1, hit: (n) => n >= 19 && n <= 36 },
  { key: "dozen1", label: "1st 12", payout: "2:1", pays: 2, hit: (n) => n >= 1 && n <= 12 },
  { key: "dozen2", label: "2nd 12", payout: "2:1", pays: 2, hit: (n) => n >= 13 && n <= 24 },
  { key: "dozen3", label: "3rd 12", payout: "2:1", pays: 2, hit: (n) => n >= 25 && n <= 36 },
  { key: "col1", label: "Col 1", payout: "2:1", pays: 2, hit: (n) => n % 3 === 1 },
  { key: "col2", label: "Col 2", payout: "2:1", pays: 2, hit: (n) => n % 3 === 2 },
  { key: "col3", label: "Col 3", payout: "2:1", pays: 2, hit: (n) => n !== 0 && n % 3 === 0 }
];
const OUTSIDE_BY_KEY = new Map(OUTSIDE.map((o) => [o.key, o]));

function resolve(state) {
  const pocket = state.deck[state.deckPos];
  state.deckPos += 1;
  state.outcome = { pocket, color: colorOf(pocket) };
}

function settleBet(bet, outcome) {
  const { option, amount } = bet;
  const { pocket, color } = outcome;
  if (option[0] === "n") return Number(option.slice(1)) === pocket ? amount * 35 : -amount;
  const o = OUTSIDE_BY_KEY.get(option);
  if (!o) return 0;
  if (pocket === 0) return -amount; // zero: all outside bets lose (the house edge)
  return o.hit(pocket, color) ? amount * o.pays : -amount;
}

function betOptions() {
  const nums = Array.from({ length: 37 }, (_, n) => ({ key: `n${n}`, label: String(n), payout: "35:1" }));
  return [...OUTSIDE.map(({ key, label, payout }) => ({ key, label, payout })), ...nums];
}

function outcomeView(state) {
  const { pocket, color } = state.outcome;
  const cap = color[0].toUpperCase() + color.slice(1);
  return { headline: pocket === 0 ? "0 — zero" : `${pocket} ${cap}` };
}

export const roulette = bankedBetGame({
  key: "roulette",
  name: "Roulette",
  deck: () => Array.from({ length: 37 }, (_, i) => i),
  maxPayoutMultiple: 35, // a straight-up number pays 35:1
  defaults: { minBet: 1 },
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
