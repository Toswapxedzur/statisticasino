// Caribbean Stud: dealer qualification (A-K high), the call-bet paytable, folds,
// and banked settlement summing to zero. Deal order (1 player): player = deck[0..4],
// dealer = deck[5..9].

import { test } from "node:test";
import assert from "node:assert/strict";
import { caribbeanStud } from "./caribbean-stud.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d", "7h", "8c", "9d", "Tc", "Jh"];
function runRound(deck, actions, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = caribbeanStud.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  const q = [...actions];
  let guard = 0;
  while (!caribbeanStud.isComplete(state)) {
    assert.ok(guard++ < 40, "terminates");
    const seat = caribbeanStud.actorSeat(state);
    state = caribbeanStud.applyAction(state, q.shift() || caribbeanStud.defaultAction(state, seat)).state;
  }
  const results = caribbeanStud.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });
const CALL = { seat: 1, type: "call" };
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a flush beats a qualifying dealer and pays the call 5:1", () => {
  const deck = ["Ah", "Kh", "Qh", "Jh", "9h", "4d", "4c", "2s", "7d", "8h"]; // flush vs pair of 4s
  const r = runRound(deck, [ANTE(10), CALL]);
  assert.equal(r.player.outcome, "win");
  assert.equal(r.player.delta, 10 + 20 * 5, "ante 10 + call 20 × 5:1");
  sumsZero(r);
});

test("a royal flush pays the call 100:1", () => {
  const deck = ["Ah", "Kh", "Qh", "Jh", "Th", "4d", "4c", "2s", "7d", "8h"];
  const r = runRound(deck, [ANTE(10), CALL]);
  assert.equal(r.player.delta, 10 + 20 * 100);
});

test("a non-qualifying dealer pays the ante and pushes the call", () => {
  const deck = ["Ah", "Kh", "Qh", "Jh", "9h", "9d", "7c", "2s", "4h", "8s"]; // dealer 9-high, no A-K
  const r = runRound(deck, [ANTE(10), CALL]);
  assert.equal(r.player.outcome, "no-qualify");
  assert.equal(r.player.delta, 10);
});

test("losing to a qualifying dealer loses ante + call", () => {
  const deck = ["2h", "3d", "5c", "7s", "9h", "Ad", "Ac", "Kh", "Qs", "Js"]; // 9-high vs pair of aces
  const r = runRound(deck, [ANTE(10), CALL]);
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -(10 + 20));
  sumsZero(r);
});

test("folding loses only the ante", () => {
  const deck = ["2h", "3d", "5c", "7s", "9h", "Ad", "Ac", "Kh", "Qs", "Js"];
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "fold" }]);
  assert.equal(r.player.delta, -10);
});
