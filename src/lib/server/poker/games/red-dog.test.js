// Red Dog: spread payouts, the immediate pair / consecutive resolutions, the
// raise decision, and banked settlement. Deal order: community = deck[0], deck[1],
// then the third card = deck[2].

import { test } from "node:test";
import assert from "node:assert/strict";
import { redDog } from "./red-dog.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d"];
function runRound(deck, actions, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = redDog.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  const q = [...actions];
  let guard = 0;
  while (!redDog.isComplete(state)) {
    assert.ok(guard++ < 40, "terminates");
    const seat = redDog.actorSeat(state);
    state = redDog.applyAction(state, q.shift() || redDog.defaultAction(state, seat)).state;
  }
  const results = redDog.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a raised spread-1 that hits pays 5:1 on the total wager", () => {
  const deck = ["5h", "7d", "6c"]; // spread 1 (only 6 between), third 6 is inside
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "raise" }]);
  assert.equal(r.state.spread, 1);
  assert.equal(r.player.outcome, "win");
  assert.equal(r.player.delta, (10 + 10) * 5);
  sumsZero(r);
});

test("checking a spread win pays only the ante stake", () => {
  const deck = ["5h", "9d", "7c"]; // spread 3 (6,7,8 between) → pays 2:1, third 7 inside
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "check" }]);
  assert.equal(r.state.spread, 3);
  assert.equal(r.player.delta, 10 * 2);
});

test("a third card outside the spread loses the wager", () => {
  const deck = ["5h", "9d", "Kc"]; // K is not between 5 and 9
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "raise" }]);
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -(10 + 10));
});

test("a pair whose third card makes trips pays 11:1 (no decision)", () => {
  const deck = ["7h", "7d", "7c"];
  const r = runRound(deck, [ANTE(10)]);
  assert.equal(r.state.outcome.kind, "pair");
  assert.equal(r.player.delta, 10 * 11);
  sumsZero(r);
});

test("a pair without trips, and consecutive cards, both push", () => {
  assert.equal(runRound(["7h", "7d", "2c"], [ANTE(10)]).player.delta, 0, "pair, no trips");
  assert.equal(runRound(["7h", "8d"], [ANTE(10)]).player.delta, 0, "consecutive");
});
