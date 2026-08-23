// Sic Bo (three dice) as a bet-selection game. Dice can repeat, so the "deck"
// is a MULTISET of faces (12 of each 1–6 = 72); GameTable shuffles it with its
// seeded RNG and we take three — approximately independent rolls, kept
// deterministic + JSON-cloneable like every other module.
//
// Bets: Small (4–10) / Big (11–17), both LOSE on any triple; a Single number
// pays 1:1 per die showing it; Any Triple pays 30:1.

import { bankedBetGame } from "./bet-game.js";

function deck() {
  const d = [];
  for (let i = 0; i < 12; i += 1) for (let face = 1; face <= 6; face += 1) d.push(face);
  return d;
}

function resolve(state) {
  const dice = [state.deck[state.deckPos], state.deck[state.deckPos + 1], state.deck[state.deckPos + 2]];
  state.deckPos += 3;
  const sum = dice[0] + dice[1] + dice[2];
  const triple = dice[0] === dice[1] && dice[1] === dice[2];
  state.outcome = { dice, sum, triple };
}

function settleBet(bet, outcome) {
  const { option, amount } = bet;
  const { dice, sum, triple } = outcome;
  if (option === "small") return !triple && sum >= 4 && sum <= 10 ? amount : -amount;
  if (option === "big") return !triple && sum >= 11 && sum <= 17 ? amount : -amount;
  if (option === "anytriple") return triple ? amount * 30 : -amount;
  if (option[0] === "s") {
    const count = dice.filter((d) => d === Number(option.slice(1))).length;
    return count > 0 ? amount * count : -amount; // 1:1 per matching die
  }
  return 0;
}

function betOptions() {
  const singles = Array.from({ length: 6 }, (_, i) => ({ key: `s${i + 1}`, label: `Single ${i + 1}`, payout: "1–3:1" }));
  return [
    { key: "small", label: "Small", payout: "1:1 · 4–10" },
    { key: "big", label: "Big", payout: "1:1 · 11–17" },
    ...singles,
    { key: "anytriple", label: "Any Triple", payout: "30:1" }
  ];
}

function outcomeView(state) {
  const { dice, sum, triple } = state.outcome;
  const tag = triple ? "Triple!" : sum >= 4 && sum <= 10 ? "Small" : "Big";
  return { headline: `🎲 ${dice.join(" · ")}  = ${sum} · ${tag}` };
}

export const sicBo = bankedBetGame({
  key: "sic-bo",
  name: "Sic Bo",
  deck,
  maxPayoutMultiple: 30, // Any Triple pays 30:1
  defaults: { minBet: 1 },
  betOptions,
  resolve,
  settleBet,
  outcomeView
});
