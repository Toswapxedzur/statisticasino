// Money Wheel (Big Six) — a 54-slot wheel: 23×1, 15×2, 8×5, 4×10, 2×20, and 2
// jokers. Bet a segment; it pays its face value to 1 (jokers 45:1). Pure RNG —
// the "deck" is the 54 slots, shuffled by the seeded GameTable RNG.

import { bankedBetGame } from "./bet-game.js";

const SLOTS = [
  ["1", 23, 1], ["2", 15, 2], ["5", 8, 5], ["10", 4, 10], ["20", 2, 20], ["joker", 2, 45]
]; // [key, count on the wheel, payout-to-1]
const PAY = new Map(SLOTS.map(([k, , p]) => [k, p]));

function buildWheel() {
  const w = [];
  for (const [k, count] of SLOTS) for (let i = 0; i < count; i += 1) w.push(k);
  return w;
}

function resolve(state) {
  const slot = state.deck[state.deckPos];
  state.deckPos += 1;
  state.outcome = { slot };
}

function settleBet(bet, outcome) {
  const { option, amount } = bet;
  if (!PAY.has(option)) return 0;
  return option === outcome.slot ? amount * PAY.get(option) : -amount;
}

function betOptions() {
  return SLOTS.map(([k, , p]) => ({ key: k, label: k === "joker" ? "Joker" : `$${k}`, payout: `${p}:1` }));
}

function outcomeView(state) {
  const s = state.outcome.slot;
  return { headline: s === "joker" ? "🃏 Joker!" : `$${s}` };
}

export const moneyWheel = bankedBetGame({
  key: "money-wheel",
  name: "Money Wheel",
  deck: buildWheel,
  maxPayoutMultiple: 45,
  defaults: { minBet: 1 },
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
