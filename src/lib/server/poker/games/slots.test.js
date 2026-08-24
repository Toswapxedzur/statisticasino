// Slots: three-of-a-kind and cherry payouts, and banked settlement. The three
// reels are deck[0], deck[1], deck[2].

import { test } from "node:test";
import assert from "node:assert/strict";
import { slots } from "./slots.js";

const FILLER = ["cherry", "lemon", "bell"];
function spin(deck, amount = 10, stack = 100000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = slots.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = slots.applyAction(state, { seat: 1, type: "bet", bets: [{ option: "spin", amount }] }).state;
  assert.ok(slots.isComplete(state));
  const results = slots.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("three diamonds pay 100:1 and the banker covers it", () => {
  const r = spin(["diamond", "diamond", "diamond"], 10);
  assert.equal(r.player.delta, 1000);
  assert.equal(r.banker.delta, -1000);
  sumsZero(r);
});

test("three-of-a-kind pays by symbol", () => {
  assert.equal(spin(["seven", "seven", "seven"], 10).player.delta, 500);
  assert.equal(spin(["cherry", "cherry", "cherry"], 10).player.delta, 100, "three cherries → 10:1");
  assert.equal(spin(["lemon", "lemon", "lemon"], 10).player.delta, 50);
});

test("loose cherries pay 1:1 (one) and 2:1 (two)", () => {
  assert.equal(spin(["cherry", "lemon", "bell"], 10).player.delta, 10, "one cherry");
  assert.equal(spin(["cherry", "cherry", "lemon"], 10).player.delta, 20, "two cherries");
});

test("no matching symbols loses the bet", () => {
  const r = spin(["lemon", "bell", "bar"], 10);
  assert.equal(r.player.delta, -10);
  sumsZero(r);
});
