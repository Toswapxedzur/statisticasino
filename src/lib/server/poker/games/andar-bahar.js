// Andar Bahar — deal a "joker", then deal cards alternately to the Andar and
// Bahar piles until one matches the joker's RANK; that side wins. The side that
// gets the first card (chosen by the joker's colour) has the edge, so Andar pays
// 0.9:1 and Bahar 1:1.

import { shoe, take } from "./toolkit.js";
import { bankedBetGame } from "./bet-game.js";

const DEFAULTS = { minBet: 1, andarCommission: 10 }; // Andar pays (10-1)/10 = 0.9:1

function resolve(state) {
  const joker = take(state, 1)[0];
  const target = joker[0];
  let side = joker[1] === "c" || joker[1] === "s" ? "andar" : "bahar"; // black joker → Andar first
  const andar = [];
  const bahar = [];
  let winner = null;
  while (!winner) {
    const card = take(state, 1)[0];
    (side === "andar" ? andar : bahar).push(card);
    if (card[0] === target) winner = side;
    side = side === "andar" ? "bahar" : "andar";
  }
  state.outcome = { joker, target, andar, bahar, winner };
}

function settleBet(bet, outcome, config) {
  const { option, amount } = bet;
  const w = outcome.winner;
  if (option === "andar") return w === "andar" ? Math.floor((amount * (config.andarCommission - 1)) / config.andarCommission) : -amount;
  if (option === "bahar") return w === "bahar" ? amount : -amount;
  return 0;
}

function betOptions() {
  return [
    { key: "andar", label: "Andar", payout: "0.9:1" },
    { key: "bahar", label: "Bahar", payout: "1:1" }
  ];
}

const NAME = { A: "A", T: "10", J: "J", Q: "Q", K: "K" };
const show = (c) => NAME[c[0]] || c[0];

function outcomeView(state) {
  const o = state.outcome;
  return {
    headline: `${o.winner === "andar" ? "Andar" : "Bahar"} matches ${show(o.joker)}`,
    hands: [
      { label: "Joker", cards: [o.joker] },
      { label: `Andar (${o.andar.length})`, cards: o.andar.slice(-5) },
      { label: `Bahar (${o.bahar.length})`, cards: o.bahar.slice(-5) }
    ]
  };
}

export const andarBahar = bankedBetGame({
  key: "andar-bahar",
  name: "Andar Bahar",
  deck: () => shoe(1),
  maxPayoutMultiple: 1,
  defaults: DEFAULTS,
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
