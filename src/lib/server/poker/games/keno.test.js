// Keno: catch counting against the 20 drawn numbers, the (spots, catches)
// paytable, skips, and banked settlement. The drawn 20 are deck[0..19]; with the
// natural [1..80] deck that's 1–20.

import { test } from "node:test";
import assert from "node:assert/strict";
import { keno } from "./keno.js";
import { kenoStrategy, KENO_TIERS } from "../bot/keno-strategy.js";

const DECK = Array.from({ length: 80 }, (_, i) => i + 1); // drawn = 1..20
function runRound(spots, amount, stack = 1000000, config = { minBet: 10 }) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = keno.startRound({ bankerSeat: 0, players, deck: DECK, config });
  state = keno.applyAction(state, { seat: 1, type: "pick", spots, amount }).state;
  assert.ok(keno.isComplete(state));
  const results = keno.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("catching all three spots pays 25:1", () => {
  const r = runRound([1, 2, 3], 10); // all in 1..20
  assert.equal(r.player.catches, 3);
  assert.equal(r.player.delta, 10 * 25);
  sumsZero(r);
});

test("a partial catch pays its paytable row", () => {
  const r = runRound([1, 2, 79], 10); // 2 caught
  assert.equal(r.player.catches, 2);
  assert.equal(r.player.delta, 10 * 1, "3 spots / 2 catches → 1:1");
});

test("too few catches loses the bet", () => {
  const r = runRound([78, 79, 80], 10); // 0 caught
  assert.equal(r.player.outcome, "lose");
  assert.equal(r.player.delta, -10);
});

test("a 10-spot solid ticket pays the 1000:1 cap and the banker covers it", () => {
  const r = runRound([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
  assert.equal(r.player.catches, 10);
  assert.equal(r.player.delta, 10 * 1000);
  assert.equal(r.banker.delta, -10 * 1000);
  sumsZero(r);
});

test("an empty ticket is a skip (no money moves)", () => {
  const r = runRound([], 0);
  assert.equal(r.player.outcome, "skip");
  assert.equal(r.player.delta, 0);
});

test("the bot marks the tier's spot count and flat-bets", () => {
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const move = kenoStrategy.decide({ turn: { phase: "pick", minBet: 10, maxSpots: 10 }, tier: KENO_TIERS.casual, rng });
  assert.equal(move.type, "pick");
  assert.equal(move.spots.length, 4);
  assert.equal(new Set(move.spots).size, 4, "distinct");
  assert.equal(move.amount, 10);
});
