// Slots (classic 3-reel) — a bet-selection game: stake on "Spin", the three reels
// resolve from a weighted strip, and three-of-a-kind (or cherries) pays a
// paytable. Reuses the bankedBetGame factory + the bet-selection UI (the reel
// result shows in the outcome headline), so it needs no new component.

import { bankedBetGame } from "./bet-game.js";

// One reel strip (20 stops): commoner symbols appear more often.
const STRIP = [
  ...Array(5).fill("cherry"), ...Array(5).fill("lemon"),
  ...Array(4).fill("bell"), ...Array(3).fill("bar"),
  ...Array(2).fill("seven"), ...Array(1).fill("diamond")
];
const EMOJI = { cherry: "🍒", lemon: "🍋", bell: "🔔", bar: "⭐", seven: "7️⃣", diamond: "💎" };
const THREE = { diamond: 100, seven: 50, bar: 20, bell: 10, cherry: 10, lemon: 5 };

function multiplier(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return THREE[a] || 0;
  const cherries = reels.filter((r) => r === "cherry").length;
  if (cherries === 2) return 2;
  if (cherries === 1) return 1;
  return 0;
}

function resolve(state) {
  const reels = [state.deck[state.deckPos], state.deck[state.deckPos + 1], state.deck[state.deckPos + 2]];
  state.deckPos += 3;
  state.outcome = { reels };
}

function settleBet(bet, outcome) {
  const m = multiplier(outcome.reels);
  return m > 0 ? bet.amount * m : -bet.amount;
}

function outcomeView(state) {
  const reels = state.outcome.reels.map((s) => EMOJI[s]).join("  ");
  const m = multiplier(state.outcome.reels);
  return { headline: `${reels}   ${m > 0 ? `pays ${m}:1` : "no win"}` };
}

export const slots = bankedBetGame({
  key: "slots",
  name: "Slots",
  deck: () => [...STRIP, ...STRIP, ...STRIP], // three strips → ~independent reels after shuffle
  maxPayoutMultiple: 100, // three diamonds
  defaults: { minBet: 1 },
  betOptions: () => [{ key: "spin", label: "Spin the reels", payout: "up to 100:1" }],
  resolve,
  settleBet,
  outcomeView
});
