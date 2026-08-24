// Craps: the come-out line results, the point cycle (made vs seven-out), the
// don't-pass 12 push, and one-roll Field payouts. Each roll = deck[i] + deck[i+1].

import { test } from "node:test";
import assert from "node:assert/strict";
import { craps } from "./craps.js";

const FILLER = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4];
function runRound(deck, option, amount = 10, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = craps.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = craps.applyAction(state, { seat: 1, type: "bet", bets: [{ option, amount }] }).state;
  assert.ok(craps.isComplete(state));
  const results = craps.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a come-out 7 wins the Pass line", () => {
  const r = runRound([3, 4], "pass"); // 7
  assert.equal(r.state.outcome.passResult, "win");
  assert.equal(r.player.delta, 10);
  assert.equal(runRound([3, 4], "dontpass").player.delta, -10);
  sumsZero(r);
});

test("come-out craps (2) loses Pass, wins Don't Pass", () => {
  assert.equal(runRound([1, 1], "pass").player.delta, -10);
  assert.equal(runRound([1, 1], "dontpass").player.delta, 10);
});

test("a come-out 12 pushes Don't Pass", () => {
  const r = runRound([6, 6], "dontpass");
  assert.equal(r.state.outcome.dontResult, "push");
  assert.equal(r.player.delta, 0);
  assert.equal(runRound([6, 6], "pass").player.delta, -10);
});

test("making the point wins Pass; sevening out wins Don't Pass", () => {
  const made = runRound([4, 4, 5, 3], "pass"); // point 8, then 8
  assert.equal(made.state.outcome.point, 8);
  assert.equal(made.player.delta, 10);
  const out = runRound([2, 3, 3, 4], "pass"); // point 5, then 7
  assert.equal(out.player.delta, -10);
  assert.equal(runRound([2, 3, 3, 4], "dontpass").player.delta, 10);
});

test("the Field pays the come-out roll", () => {
  assert.equal(runRound([1, 1], "field").player.delta, 20, "2 pays 2:1");
  assert.equal(runRound([6, 6], "field").player.delta, 30, "12 pays 3:1");
  assert.equal(runRound([1, 2], "field").player.delta, 10, "3 pays 1:1");
  assert.equal(runRound([2, 3], "field").player.delta, -10, "5 is not in the field");
});
