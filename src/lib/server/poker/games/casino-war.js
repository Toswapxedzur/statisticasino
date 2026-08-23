// Casino War (simplified bet-selection form) — one card to the Player, one to the
// Dealer; higher rank wins even money and the Player bet PUSHES on a tie. A
// separate Tie side bet pays 10:1. (The full "go to war" raise on a tie is an
// action-based variant; this is the one-shot version.)

import { shoe, take } from "./toolkit.js";
import { bankedBetGame } from "./bet-game.js";

const RANK = { A: 14, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13 };
const DEFAULTS = { minBet: 1, tiePayout: 10 };

function resolve(state) {
  const player = take(state, 1)[0];
  const dealer = take(state, 1)[0];
  const pv = RANK[player[0]];
  const dv = RANK[dealer[0]];
  const winner = pv > dv ? "player" : dv > pv ? "dealer" : "tie";
  state.outcome = { player, dealer, pv, dv, winner };
}

function settleBet(bet, outcome, config) {
  const { option, amount } = bet;
  const w = outcome.winner;
  if (option === "ante") return w === "player" ? amount : w === "tie" ? 0 : -amount;
  if (option === "tie") return w === "tie" ? amount * config.tiePayout : -amount;
  return 0;
}

function betOptions(config) {
  return [
    { key: "ante", label: "Player", payout: "1:1 · push on tie" },
    { key: "tie", label: "Tie", payout: `${config.tiePayout}:1` }
  ];
}

const NAME = { A: "A", T: "10", J: "J", Q: "Q", K: "K" };
const show = (c) => NAME[c[0]] || c[0];

function outcomeView(state) {
  const o = state.outcome;
  return {
    headline: o.winner === "tie" ? "War! (tie)" : o.winner === "player" ? "Player wins" : "Dealer wins",
    hands: [
      { label: `Player (${show(o.player)})`, cards: [o.player] },
      { label: `Dealer (${show(o.dealer)})`, cards: [o.dealer] }
    ]
  };
}

export const casinoWar = bankedBetGame({
  key: "casino-war",
  name: "Casino War",
  deck: () => shoe(1),
  maxPayoutMultiple: DEFAULTS.tiePayout,
  defaults: DEFAULTS,
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
