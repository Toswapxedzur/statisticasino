// Andar Bahar: joker colour picks the starting side, first side to match the
// joker's rank wins; Andar pays 0.9:1, Bahar 1:1, banked settlement sums to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { andarBahar } from "./andar-bahar.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d", "8c", "9h", "Tc"]; // no 7s → no stray match
function play(deck, bets, stack = 1000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = andarBahar.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = andarBahar.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(andarBahar.isComplete(state));
  const results = andarBahar.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("black joker deals Andar first; an immediate match wins Andar at 0.9:1", () => {
  const r = play(["7c", "7h"], [{ option: "andar", amount: 10 }]); // 7c black → Andar; 7h matches
  assert.equal(r.state.outcome.winner, "andar");
  assert.equal(r.player.delta, 9, "floor(10 × 9/10) = 9");
  sumsZero(r);
});

test("Bahar wins pays full 1:1", () => {
  const r = play(["7c", "2h", "7d"], [{ option: "bahar", amount: 10 }]); // Andar 2h (no), Bahar 7d (match)
  assert.equal(r.state.outcome.winner, "bahar");
  assert.equal(r.player.delta, 10);
});

test("red joker deals Bahar first", () => {
  const r = play(["7d", "7h"], [{ option: "bahar", amount: 10 }]); // 7d red → Bahar; 7h matches
  assert.equal(r.state.outcome.winner, "bahar");
});

test("the losing side loses the stake", () => {
  assert.equal(play(["7c", "7h"], [{ option: "bahar", amount: 10 }]).player.delta, -10);
});
