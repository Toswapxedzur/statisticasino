// River Sprint economics & ranking — pure functions, no DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prizePool, netFaucet, payoutTable, rankStandings, sprintBadges, dayKey, SPRINT,
} from "./sprint-core.js";

test("prizePool grosses bids up so the faucet is exactly 30% of the pool", () => {
  // 1400 bids at 30% faucet → pool 2000; overlay 600 = 30% of 2000.
  const pool = prizePool(1400, 3000);
  assert.equal(pool, 2000);
  assert.equal(netFaucet(pool, 1400), 600);
  assert.equal(Math.round((netFaucet(pool, 1400) / pool) * 10000), 3000);
  assert.equal(prizePool(0), 0);
});

test("payoutTable is top-heavy, pays ~15% of the field, and sums to the pool", () => {
  const pool = 10000, field = 20;
  const prizes = payoutTable(pool, field, 0.15);
  assert.equal(prizes.length, Math.ceil(field * 0.15)); // 3 paid
  assert.equal(prizes.reduce((a, b) => a + b, 0), pool, "sums to pool exactly");
  for (let i = 1; i < prizes.length; i++) assert.ok(prizes[i] <= prizes[i - 1], "monotonic decreasing");
  assert.ok(prizes[0] > pool / prizes.length, "champion takes above an even split");
});

test("payoutTable pays at least one place and handles a single entrant", () => {
  assert.deepEqual(payoutTable(1000, 1), [1000]);
  assert.deepEqual(payoutTable(0, 50), []);
});

test("rankStandings: stack desc, then survival time, then stable id", () => {
  const ranked = rankStandings([
    { id: "c", stack: 0, bustAt: 100 },
    { id: "a", stack: 500 },
    { id: "b", stack: 500 },
    { id: "d", stack: 0, bustAt: 900 },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b", "d", "c"]);
  assert.deepEqual(ranked.map((r) => r.place), [1, 2, 3, 4]);
});

test("sprintBadges reflect finishing place", () => {
  assert.deepEqual(sprintBadges({ place: 1, paidPlaces: 10 }).sort(), ["sprint_champ", "sprint_final", "sprint_itm"]);
  assert.deepEqual(sprintBadges({ place: 5, paidPlaces: 10 }).sort(), ["sprint_final", "sprint_itm"]);
  assert.deepEqual(sprintBadges({ place: 12, paidPlaces: 10 }), []); // out of the money, off the final table
  assert.deepEqual(sprintBadges({ place: 9, paidPlaces: 3 }), ["sprint_final"]); // final table but unpaid
});

test("dayKey is a UTC calendar day", () => {
  assert.match(dayKey(Date.UTC(2026, 7, 27, 23, 59)), /^2026-08-27$/);
  assert.equal(SPRINT.ROUNDS_PER_DAY, 2);
});
