// Ultimate Texas Hold'em: the play-bet multiples, ante/blind/play settlement, the
// blind paytable (incl. the 3:2 flush floor), folding, and conservation across the
// multi-street advance. Deal order (1 player): player = deck[0,1], dealer =
// deck[2,3], flop = deck[4,5,6], turn+river = deck[7,8].

import { test } from "node:test";
import assert from "node:assert/strict";
import { ultimateHoldem } from "./ultimate-holdem.js";

const FILLER = ["2c", "3s", "4d", "5h", "6c", "7s", "8d", "9h", "Tc", "Jd"];
function runRound(deck, actions, stack = 100000, players = [{ seat: 1, userId: "u1", stack: 100000 }], config) {
  let state = ultimateHoldem.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  const q = [...actions];
  let guard = 0;
  while (!ultimateHoldem.isComplete(state)) {
    assert.ok(guard++ < 60, "terminates");
    const seat = ultimateHoldem.actorSeat(state);
    state = ultimateHoldem.applyAction(state, q.shift() || ultimateHoldem.defaultAction(state, seat)).state;
  }
  const results = ultimateHoldem.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("play 4× preflop and win with a straight (blind pays 1:1)", () => {
  const deck = ["Ts", "9s", "Kc", "Kd", "8h", "7c", "6d", "2s", "3h"]; // straight vs pair of kings
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "play4x" }]);
  assert.equal(r.player.outcome, "win");
  assert.equal(r.player.delta, 40 + 10 + 10, "play 40 + ante 10 + blind 10×1");
  sumsZero(r);
});

test("a flush pays the blind 3:2 (floored)", () => {
  const deck = ["Ah", "Kh", "2c", "2d", "Qh", "7h", "3h", "8s", "9d"]; // flush vs pair of 2s
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "play4x" }]);
  assert.equal(r.player.delta, 40 + 10 + 15, "play 40 + ante 10 + blind floor(10×1.5)=15");
});

test("checking to the river then folding loses ante + blind", () => {
  const deck = ["2h", "3d", "Kc", "Ah", "5s", "6c", "7d", "8h", "9s"];
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "check" }, { seat: 1, type: "check" }, { seat: 1, type: "fold" }]);
  assert.equal(r.player.outcome, "fold");
  assert.equal(r.player.delta, -20);
});

test("losing at showdown loses ante + blind + play", () => {
  const deck = ["2c", "3d", "As", "Ks", "Ah", "Kh", "Qc", "Jd", "4s"]; // high card vs two pair
  const r = runRound(deck, [ANTE(10), { seat: 1, type: "play4x" }]);
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -(10 + 10 + 40));
  sumsZero(r);
});

test("two players, all defaults, chips conserved across streets", () => {
  const players = [{ seat: 1, userId: "a", stack: 100000 }, { seat: 2, userId: "b", stack: 100000 }];
  const r = runRound(ultimateHoldem.deck(), [], 100000, players, { minBet: 5 });
  assert.equal(r.results.length, 3, "two players + banker");
  assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0, "conserved");
});
