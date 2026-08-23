// Dragon Tiger — the fastest card game: one card to Dragon, one to Tiger, higher
// rank wins (Ace is LOW). Bet Dragon / Tiger / Tie. On a tie, Dragon/Tiger bets
// lose HALF (the house edge); the Tie bet pays 8:1.

import { shoe, take } from "./toolkit.js";
import { bankedBetGame } from "./bet-game.js";

const RANK = { A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13 };
const DEFAULTS = { minBet: 1, tiePayout: 8 };

function resolve(state) {
  const dragon = take(state, 1)[0];
  const tiger = take(state, 1)[0];
  const dv = RANK[dragon[0]];
  const tv = RANK[tiger[0]];
  const winner = dv > tv ? "dragon" : tv > dv ? "tiger" : "tie";
  state.outcome = { dragon, tiger, dv, tv, winner };
}

function settleBet(bet, outcome, config) {
  const { option, amount } = bet;
  const w = outcome.winner;
  if (option === "tie") return w === "tie" ? amount * config.tiePayout : -amount;
  if (option === "dragon" || option === "tiger") {
    if (w === "tie") return -Math.floor(amount / 2); // half to the house on a tie
    return w === option ? amount : -amount;
  }
  return 0;
}

function betOptions(config) {
  return [
    { key: "dragon", label: "Dragon", payout: "1:1" },
    { key: "tiger", label: "Tiger", payout: "1:1" },
    { key: "tie", label: "Tie", payout: `${config.tiePayout}:1` }
  ];
}

const NAME = { A: "A", T: "10", J: "J", Q: "Q", K: "K" };
const show = (c) => NAME[c[0]] || c[0];

function outcomeView(state) {
  const o = state.outcome;
  return {
    headline: o.winner === "tie" ? "Tie" : o.winner === "dragon" ? "Dragon wins" : "Tiger wins",
    hands: [
      { label: `Dragon (${show(o.dragon)})`, cards: [o.dragon] },
      { label: `Tiger (${show(o.tiger)})`, cards: [o.tiger] }
    ]
  };
}

export const dragonTiger = bankedBetGame({
  key: "dragon-tiger",
  name: "Dragon Tiger",
  deck: () => shoe(1),
  maxPayoutMultiple: DEFAULTS.tiePayout,
  defaults: DEFAULTS,
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
