// Baccarat (Punto Banco) as a bet-selection game. Players bet Player / Banker /
// Tie; the two hands are dealt by fixed rules (no choices). Player pays 1:1,
// Banker 1:1 minus a 5% commission, Tie 8:1 (Player/Banker push on a tie).

import { shoe, take } from "./toolkit.js";
import { bankedBetGame } from "./bet-game.js";

const DEFAULTS = { minBet: 1, tiePayout: 8, bankerCommission: 20 }; // 20 = 1/20 = 5%

const cardVal = (rank) => (rank === "A" ? 1 : "TJQK".includes(rank) ? 0 : Number(rank));
const total = (cards) => cards.reduce((s, c) => s + cardVal(c[0]), 0) % 10;

// Deal the two hands per the Punto Banco drawing table.
function resolve(state) {
  const player = [take(state, 1)[0]];
  const banker = [take(state, 1)[0]];
  player.push(take(state, 1)[0]);
  banker.push(take(state, 1)[0]);
  let pv = total(player);
  let bv = total(banker);

  if (pv < 8 && bv < 8) { // no natural
    let playerThird = null;
    if (pv <= 5) { playerThird = take(state, 1)[0]; player.push(playerThird); pv = total(player); }
    const bankerDraws = () => {
      if (playerThird === null) return bv <= 5;      // player stood on 6/7
      const t = cardVal(playerThird[0]);
      if (bv <= 2) return true;
      if (bv === 3) return t !== 8;
      if (bv === 4) return t >= 2 && t <= 7;
      if (bv === 5) return t >= 4 && t <= 7;
      if (bv === 6) return t >= 6 && t <= 7;
      return false;                                   // bv === 7
    };
    if (bankerDraws()) { banker.push(take(state, 1)[0]); bv = total(banker); }
  }

  const winner = pv > bv ? "player" : bv > pv ? "banker" : "tie";
  state.outcome = { player: { cards: player, value: pv }, banker: { cards: banker, value: bv }, winner };
}

function settleBet(bet, outcome, config) {
  const { option, amount } = bet;
  const w = outcome.winner;
  if (option === "player") return w === "player" ? amount : w === "tie" ? 0 : -amount;
  if (option === "banker") {
    if (w === "banker") return Math.floor(amount * (config.bankerCommission - 1) / config.bankerCommission); // 0.95:1
    return w === "tie" ? 0 : -amount;
  }
  if (option === "tie") return w === "tie" ? amount * config.tiePayout : -amount;
  return 0;
}

function betOptions(config) {
  return [
    { key: "player", label: "Player", payout: "1:1" },
    { key: "banker", label: "Banker", payout: "1:1 (−5%)" },
    { key: "tie", label: "Tie", payout: `${config.tiePayout}:1` }
  ];
}

function outcomeView(state) {
  const o = state.outcome;
  return {
    headline: o.winner === "tie" ? "Tie" : o.winner === "player" ? "Player wins" : "Banker wins",
    hands: [
      { label: `Player (${o.player.value})`, cards: o.player.cards },
      { label: `Banker (${o.banker.value})`, cards: o.banker.cards }
    ]
  };
}

export const baccarat = bankedBetGame({
  key: "baccarat",
  name: "Baccarat",
  deck: () => shoe(1),
  maxPayoutMultiple: DEFAULTS.tiePayout, // 8:1 tie is the biggest single win
  defaults: DEFAULTS,
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
