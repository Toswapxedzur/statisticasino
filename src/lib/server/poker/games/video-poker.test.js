// Video Poker: the hold-and-draw mechanic, the Jacks-or-Better paytable, and
// banked settlement. Deal order (1 player): hand = deck[0..4]; redrawn cards come
// from deck[5..] in ascending held-slot order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { videoPoker } from "./video-poker.js";
import { videoPokerStrategy, VP_TIERS } from "../bot/video-poker-strategy.js";

const FILLER = ["2s", "3h", "4c", "5d", "6s", "7h", "8c", "9d", "Ts", "Jc"];
function runRound(deck, holds, config = { minBet: 10 }, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = videoPoker.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  state = videoPoker.applyAction(state, { seat: 1, type: "draw", holds }).state;
  assert.ok(videoPoker.isComplete(state));
  const results = videoPoker.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const HOLD_ALL = [true, true, true, true, true];
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("standing pat on a royal flush pays 250:1", () => {
  const r = runRound(["Ah", "Kh", "Qh", "Jh", "Th"], HOLD_ALL);
  assert.equal(r.player.delta, 10 * 250);
  assert.equal(r.banker.delta, -10 * 250);
  sumsZero(r);
});

test("holding a pair and drawing into two pair pays 2:1", () => {
  // Ah As held, draw 3 → deck[5,6,7] = Kh Kd Qs → aces up.
  const r = runRound(["Ah", "As", "2c", "3d", "4h", "Kh", "Kd", "Qs"], [true, true, false, false, false]);
  assert.deepEqual(r.state.players[0].cards, ["Ah", "As", "Kh", "Kd", "Qs"]);
  assert.equal(r.player.delta, 10 * 2);
  sumsZero(r);
});

test("a pair of jacks pays 1:1; a pair of tens loses", () => {
  assert.equal(runRound(["Jh", "Jd", "2c", "3d", "4h"], HOLD_ALL).player.delta, 10, "jacks or better");
  assert.equal(runRound(["Th", "Td", "2c", "3d", "4h"], HOLD_ALL).player.delta, -10, "pair of tens is nothing");
});

test("a busted draw loses the bet", () => {
  const r = runRound(["2c", "3d", "4h", "5s", "7c", "9d", "Tc", "2h", "3s", "4d"], [false, false, false, false, false]);
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -10);
});

test("the bot holds a made pair", () => {
  const move = videoPokerStrategy.decide({ turn: { cards: ["Ah", "As", "2c", "3d", "4h"] }, tier: VP_TIERS.basic });
  assert.deepEqual(move, { type: "draw", holds: [true, true, false, false, false] });
});
