// Roulette: the winning pocket is the top of the (test-supplied) pocket deck.
// Covers straight-up 35:1, even-money + 2:1 outside bets, the zero sweeping all
// outside bets, and banked settlement summing to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { roulette } from "./roulette.js";

const FILLER = [0, 1, 2, 3];

// The first pocket in `deck` is the result.
function spin(deck, bets, stack = 10000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = roulette.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = roulette.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(roulette.isComplete(state));
  const results = roulette.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a straight-up number pays 35:1 and the banker covers it", () => {
  const r = spin([17], [{ option: "n17", amount: 10 }]);
  assert.equal(r.state.outcome.pocket, 17);
  assert.equal(r.player.delta, 350);
  assert.equal(r.banker.delta, -350);
  sumsZero(r);
});

test("a missed straight-up loses the stake", () => {
  const r = spin([17], [{ option: "n5", amount: 10 }]);
  assert.equal(r.player.delta, -10);
  sumsZero(r);
});

test("even-money outside bets settle by colour/parity", () => {
  assert.equal(spin([3], [{ option: "red", amount: 10 }]).player.delta, 10, "3 is red");
  assert.equal(spin([3], [{ option: "black", amount: 10 }]).player.delta, -10);
  assert.equal(spin([17], [{ option: "black", amount: 10 }]).player.delta, 10, "17 is black");
  assert.equal(spin([4], [{ option: "even", amount: 10 }]).player.delta, 10);
  assert.equal(spin([4], [{ option: "low", amount: 10 }]).player.delta, 10, "4 ∈ 1–18");
});

test("dozens and columns pay 2:1", () => {
  assert.equal(spin([5], [{ option: "dozen1", amount: 10 }]).player.delta, 20, "5 ∈ 1st 12");
  assert.equal(spin([5], [{ option: "col2", amount: 10 }]).player.delta, 20, "5 is column 2 (5%3=2)");
  assert.equal(spin([5], [{ option: "col1", amount: 10 }]).player.delta, -10);
  assert.equal(spin([36], [{ option: "col3", amount: 10 }]).player.delta, 20, "36 is column 3");
});

test("zero sweeps every outside bet but pays its own straight-up", () => {
  assert.equal(spin([0], [{ option: "red", amount: 10 }]).player.delta, -10);
  assert.equal(spin([0], [{ option: "even", amount: 10 }]).player.delta, -10, "0 is not an even win");
  assert.equal(spin([0], [{ option: "dozen1", amount: 10 }]).player.delta, -10);
  assert.equal(spin([0], [{ option: "n0", amount: 10 }]).player.delta, 350);
});

test("multiple bets on one spin settle independently", () => {
  const r = spin([3], [
    { option: "red", amount: 10 },   // 3 red → +10
    { option: "n3", amount: 5 },     // hits → +175
    { option: "high", amount: 10 }   // 3 ∈ 1–18 → -10
  ]);
  assert.equal(r.player.delta, 175);
  sumsZero(r);
});
