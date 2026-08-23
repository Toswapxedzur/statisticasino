// Money Wheel: a matched segment pays its face value to 1, the joker pays 45:1,
// banked settlement sums to zero (banker covers the long-odds win).

import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyWheel } from "./money-wheel.js";

const FILLER = ["1", "1", "1", "1"];
function play(deck, bets, stack = 10000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = moneyWheel.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = moneyWheel.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(moneyWheel.isComplete(state));
  const results = moneyWheel.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a matched segment pays its face value", () => {
  assert.equal(play(["20"], [{ option: "20", amount: 10 }]).player.delta, 200, "20:1");
  assert.equal(play(["5"], [{ option: "5", amount: 10 }]).player.delta, 50);
  assert.equal(play(["1"], [{ option: "1", amount: 10 }]).player.delta, 10);
});

test("the joker pays 45:1 and the banker covers it", () => {
  const r = play(["joker"], [{ option: "joker", amount: 10 }]);
  assert.equal(r.state.outcome.slot, "joker");
  assert.equal(r.player.delta, 450);
  assert.equal(r.banker.delta, -450);
  sumsZero(r);
});

test("a miss loses the stake", () => {
  assert.equal(play(["2"], [{ option: "20", amount: 10 }]).player.delta, -10);
});
