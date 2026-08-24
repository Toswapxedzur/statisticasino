// Pai Gow Poker: win-both / lose-both / push (win one), the 5% commission, a
// manual split, and foul auto-correction. Deal order (1 player): player =
// deck[0..6], dealer = deck[7..13].

import { test } from "node:test";
import assert from "node:assert/strict";
import { paiGow } from "./pai-gow.js";

function runRound(playerHand, dealerHand, setAction = { type: "set", auto: true }, config = { minBet: 100 }) {
  const deck = [...playerHand, ...dealerHand];
  const players = [{ seat: 1, userId: "u1", stack: 100000 }];
  let state = paiGow.startRound({ bankerSeat: 0, players, deck, config });
  state = paiGow.applyAction(state, { seat: 1, ...setAction }).state;
  assert.ok(paiGow.isComplete(state));
  const results = paiGow.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("winning both hands pays even money minus 5% commission", () => {
  const player = ["Ah", "Ad", "Ac", "As", "Kh", "Qd", "Jc"]; // quad aces
  const dealer = ["2c", "3d", "4h", "5s", "7c", "8d", "9h"];  // 9-high junk
  const r = runRound(player, dealer);
  assert.equal(r.player.outcome, "win");
  assert.equal(r.player.delta, 95, "floor(100 × 19/20)");
  assert.equal(r.banker.delta, -95);
  sumsZero(r);
});

test("losing both hands loses the ante", () => {
  const player = ["2c", "3d", "4h", "5s", "7c", "8d", "9h"];
  const dealer = ["Ah", "Ad", "Ac", "As", "Kh", "Qd", "Jc"];
  const r = runRound(player, dealer);
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -100);
});

test("winning one hand and losing the other pushes", () => {
  const player = ["2s", "3s", "4s", "5s", "6s", "Ah", "Kd"]; // back = 2-6 straight flush, front A-K high
  const dealer = ["Ac", "Ad", "7h", "8h", "9h", "Tc", "Jd"]; // back = 7-J straight, front pair of aces
  const r = runRound(player, dealer);
  assert.equal(r.player.outcome, "push", "SF back beats the straight, but A-K high loses to a pair");
  assert.equal(r.player.delta, 0);
});

test("a manual split is respected", () => {
  const player = ["Ah", "Ad", "Kh", "Kd", "2c", "3d", "4h"];
  const dealer = ["7c", "8c", "9d", "Ts", "Jh", "2h", "3h"];
  const r = runRound(player, dealer, { type: "set", front: ["2c", "3d"] });
  assert.deepEqual([...r.state.players[0].split.front].sort(), ["2c", "3d"]);
});

test("a foul front is auto-corrected to a legal split", () => {
  const player = ["Ah", "Ad", "Kh", "Kd", "2c", "3d", "4h"];
  const dealer = ["7c", "8c", "9d", "Ts", "Jh", "2h", "3h"];
  // Putting the aces in front would foul (front pair > back pair); expect correction.
  const r = runRound(player, dealer, { type: "set", front: ["Ah", "Ad"] });
  assert.ok(!r.state.players[0].split.front.includes("Ah"), "aces moved out of the front");
});
