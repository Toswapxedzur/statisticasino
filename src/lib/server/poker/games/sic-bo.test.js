// Sic Bo: the roll is the first three faces of the (test-supplied) face deck.
// Covers Small/Big (and their loss on any triple), single-number pay-per-die,
// Any Triple 30:1, and banked settlement summing to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sicBo } from "./sic-bo.js";

const FILLER = [1, 1, 1];

// The first three faces in `deck` are the dice.
function roll(deck, bets, stack = 10000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = sicBo.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = sicBo.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(sicBo.isComplete(state));
  const results = sicBo.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("Small wins on a low non-triple total", () => {
  const r = roll([1, 2, 3], [{ option: "small", amount: 10 }]); // sum 6
  assert.deepEqual(r.state.outcome.dice, [1, 2, 3]);
  assert.equal(r.player.delta, 10);
  assert.equal(roll([1, 2, 3], [{ option: "big", amount: 10 }]).player.delta, -10);
  sumsZero(r);
});

test("Big wins on a high non-triple total", () => {
  const r = roll([6, 6, 5], [{ option: "big", amount: 10 }]); // sum 17
  assert.equal(r.player.delta, 10);
  assert.equal(roll([6, 6, 5], [{ option: "small", amount: 10 }]).player.delta, -10);
});

test("a triple beats both Small and Big, and pays Any Triple 30:1", () => {
  assert.equal(roll([3, 3, 3], [{ option: "small", amount: 10 }]).player.delta, -10, "triple 9 still loses Small");
  assert.equal(roll([3, 3, 3], [{ option: "big", amount: 10 }]).player.delta, -10);
  const r = roll([3, 3, 3], [{ option: "anytriple", amount: 10 }]);
  assert.equal(r.player.delta, 300);
  assert.equal(r.banker.delta, -300);
  sumsZero(r);
});

test("a single number pays 1:1 per matching die", () => {
  assert.equal(roll([4, 4, 2], [{ option: "s4", amount: 10 }]).player.delta, 20, "two 4s → 2×");
  assert.equal(roll([4, 4, 2], [{ option: "s2", amount: 10 }]).player.delta, 10, "one 2 → 1×");
  assert.equal(roll([4, 4, 2], [{ option: "s5", amount: 10 }]).player.delta, -10, "no 5 → lose");
  assert.equal(roll([5, 5, 5], [{ option: "s5", amount: 10 }]).player.delta, 30, "three 5s → 3×");
});

test("multiple bets on one roll settle independently", () => {
  const r = roll([4, 4, 2], [
    { option: "small", amount: 10 }, // sum 10, no triple → +10
    { option: "s4", amount: 10 },    // two 4s → +20
    { option: "big", amount: 10 }    // → -10
  ]);
  assert.equal(r.player.delta, 20);
  sumsZero(r);
});
