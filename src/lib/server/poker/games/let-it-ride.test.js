// Let It Ride: the paytable (pair of tens or better), pulling bets back vs letting
// them ride, and banked settlement. Deal order (1 player): hand = deck[0,1,2],
// community = deck[3,4]; the final 5-card hand is deck[0..4].

import { test } from "node:test";
import assert from "node:assert/strict";
import { letItRide } from "./let-it-ride.js";

const FILLER = ["2c", "3s", "4d"];
function runRound(deck, actions, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = letItRide.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  const q = [...actions];
  let guard = 0;
  while (!letItRide.isComplete(state)) {
    assert.ok(guard++ < 40, "terminates");
    const seat = letItRide.actorSeat(state);
    state = letItRide.applyAction(state, q.shift() || letItRide.defaultAction(state, seat)).state;
  }
  const results = letItRide.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });
const RIDE = { seat: 1, type: "ride" };
const PULL = { seat: 1, type: "pull" };
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a straight with all three bets riding pays 5:1 on each", () => {
  const deck = ["8h", "9s", "Ts", "Jd", "Qc"]; // 8-9-T-J-Q straight
  const r = runRound(deck, [ANTE(10), RIDE, RIDE]);
  assert.equal(r.player.outcome, "win");
  assert.equal(r.player.delta, 3 * 10 * 5);
  sumsZero(r);
});

test("pulling both bets leaves only the third riding", () => {
  const deck = ["8h", "9s", "Ts", "Jd", "Qc"];
  const r = runRound(deck, [ANTE(10), PULL, PULL]);
  assert.equal(r.player.delta, 1 * 10 * 5, "one riding bet on a straight");
});

test("a pair of tens pays 1:1; a lower pair loses", () => {
  assert.equal(runRound(["Th", "Td", "2s", "5c", "9h"], [ANTE(10), RIDE, RIDE]).player.delta, 3 * 10 * 1, "pair of tens");
  assert.equal(runRound(["9h", "9d", "2s", "5c", "Kh"], [ANTE(10), RIDE, RIDE]).player.delta, -(3 * 10), "pair of nines loses");
});

test("a non-paying hand loses the riding bets", () => {
  const r = runRound(["2h", "5s", "9d", "Jc", "Qh"], [ANTE(10), RIDE, RIDE]); // Q-high
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -(3 * 10));
  sumsZero(r);
});
