// Craps — banked, as a bet-selection game. You bet on the shooter BEFORE the roll;
// the whole sequence then plays out inside one round: the come-out roll wins/loses
// the line immediately (7/11 pass, 2/3/12 craps) or sets a point that's rolled for
// until it repeats (pass) or a 7 (seven-out, don't pass). Bets: Pass / Don't Pass
// (1:1, don't-pass pushes on a come-out 12) and Field (a one-roll bet on the
// come-out: 2 pays 2:1, 12 pays 3:1, 3·4·9·10·11 pay 1:1). Reuses the bet UI —
// the roll sequence shows in the outcome headline.

import { bankedBetGame } from "./bet-game.js";

// The "deck" is a multiset of dice faces (like sic-bo) so successive rolls are
// ~independent while staying seeded + JSON-cloneable. 132 faces = up to 66 rolls.
function deck() {
  const d = [];
  for (let i = 0; i < 22; i += 1) for (let f = 1; f <= 6; f += 1) d.push(f);
  return d;
}

function rollSum(state) {
  const a = state.deck[state.deckPos];
  const b = state.deck[state.deckPos + 1];
  state.deckPos += 2;
  return a + b;
}

function resolve(state) {
  const rolls = [];
  const comeOut = rollSum(state);
  rolls.push(comeOut);
  let passResult;
  let dontResult;
  let point = null;

  if (comeOut === 7 || comeOut === 11) { passResult = "win"; dontResult = "lose"; }
  else if (comeOut === 2 || comeOut === 3) { passResult = "lose"; dontResult = "win"; }
  else if (comeOut === 12) { passResult = "lose"; dontResult = "push"; }
  else {
    point = comeOut;
    let done = false;
    while (!done && state.deckPos + 2 <= state.deck.length) {
      const r = rollSum(state);
      rolls.push(r);
      if (r === point) { passResult = "win"; dontResult = "lose"; done = true; }
      else if (r === 7) { passResult = "lose"; dontResult = "win"; done = true; }
    }
    if (!done) { passResult = "lose"; dontResult = "win"; } // exhausted → treat as seven-out
  }
  state.outcome = { comeOut, point, rolls, passResult, dontResult };
}

function fieldMult(sum) {
  if (sum === 2) return 2;
  if (sum === 12) return 3;
  if (sum === 3 || sum === 4 || sum === 9 || sum === 10 || sum === 11) return 1;
  return 0;
}

function settleBet(bet, outcome) {
  const { option, amount } = bet;
  if (option === "pass") return outcome.passResult === "win" ? amount : -amount;
  if (option === "dontpass") return outcome.dontResult === "win" ? amount : outcome.dontResult === "push" ? 0 : -amount;
  if (option === "field") { const m = fieldMult(outcome.comeOut); return m > 0 ? amount * m : -amount; }
  return 0;
}

function outcomeView(state) {
  const o = state.outcome;
  const line = o.passResult === "win" ? "Pass wins" : "Don't Pass wins";
  const pt = o.point ? ` · point ${o.point}` : "";
  return { headline: `🎲 ${o.rolls.join(", ")}${pt} — ${line}` };
}

export const craps = bankedBetGame({
  key: "craps",
  name: "Craps",
  deck,
  maxPayoutMultiple: 3, // Field pays 3:1 on a 12
  defaults: { minBet: 1 },
  betOptions: () => [
    { key: "pass", label: "Pass Line", payout: "1:1" },
    { key: "dontpass", label: "Don't Pass", payout: "1:1" },
    { key: "field", label: "Field", payout: "2/3/4/9/10/11, 12→3:1" }
  ],
  resolve,
  settleBet,
  outcomeView
});
