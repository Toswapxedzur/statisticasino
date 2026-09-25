import { test } from "node:test";
import assert from "node:assert/strict";
import { Money, COIN, breakdown, DENOMS } from "./coin-motion.js";

const total = (m) => [...m.stack.values()].reduce((a, b) => a + b, 0)
  + [...m.piles.values()].reduce((a, b) => a + b, 0)
  + m.flights.filter((f) => !f.landed).reduce((a, f) => a + f.amount, 0);

// a hand: blinds, a raise and calls, sweep; flop bet + raise + call, sweep; turn bet, fold,
// the uncalled bet back, the pot to the winner
function hand() {
  const m = new Money({ 1: 200, 2: 200, 4: 200, 5: 200 });
  m.bet(1, 1, 0); m.bet(2, 2, 0);
  m.bet(4, 8, 600); m.bet(5, 8, 1200); m.bet(1, 7, 1800); m.bet(2, 6, 2000);
  m.sweep(2050);                       // asked while the last call is still in the air
  m.check(1, 3500); m.bet(4, 20, 3900); m.bet(5, 60, 4500); m.bet(4, 40, 5100);
  m.sweep(5200);
  m.bet(5, 90, 6500); m.giveBack(5, 90, 7000);
  m.award([{ seat: 5, amount: 152 }], 7000);
  return m;
}

test("breakdown: highest coins first, every chip counted", () => {
  assert.deepEqual(breakdown(1234), [{ denom: 500, count: 2 }, { denom: 100, count: 2 }, { denom: 25, count: 1 }, { denom: 5, count: 1 }, { denom: 1, count: 4 }]);
  for (const n of [1, 7, 99, 2600, 1_234_567]) assert.equal(breakdown(n).reduce((a, c) => a + c.denom * c.count, 0), n);
  assert.deepEqual([...DENOMS].sort((a, b) => b - a), DENOMS);
});

test("money is conserved at every moment of a hand", () => {
  const m = hand(), start = total(m);
  for (let t = 0; t <= 12000; t += 5) { m.tick(t); assert.equal(total(m), start, `at ${t} ms`); }
  assert.equal(m.flights.length, 0);
  assert.deepEqual([...m.piles], []);
  assert.equal(m.stack.get(5), 200 - 8 - 60 + 152);
  assert.equal(m.stack.get(4), 200 - 8 - 20 - 40);
});

test("a bet leaves in columns, highest first, and stacks onto the pile as they land", () => {
  const m = new Money({ 3: 1000 });
  m.bet(3, 137, 0);                    // 100 + 25 + 5 + 7×1
  m.tick(1);
  assert.equal(m.flights.length, 1);
  assert.equal(m.flights[0].denom, 100);
  assert.equal(m.stackAt(3, 1), 900, "the badge drops as a column leaves");
  m.tick(3 * COIN.every + 1);
  assert.deepEqual(m.flights.map((f) => f.denom), [100, 25, 5, 1]);
  m.tick(COIN.flight + 1);
  assert.equal(m.piles.get("bet:3"), 100);
  m.tick(3 * COIN.every + COIN.flight + 1);
  assert.equal(m.piles.get("bet:3"), 137);
  assert.equal(m.cues.filter((c) => c.name === "bet").length, 1, "one chip sound per bet, on landing");
});

test("the sweep waits for the last bet, then every pile lands in the pot at the same moment", () => {
  const m = hand();
  let sweep = null;
  for (let t = 0; t <= 3400; t += 1) {
    m.tick(t);
    const s = m.flights.filter((f) => f.to.kind === "pot");
    if (s.length && !sweep) sweep = s.map((f) => ({ t0: f.t0, land: f.t0 + f.dur }));
  }
  assert.equal(sweep.length, 4);
  const lastCall = 2000 + COIN.every + COIN.flight;   // bet(2, 6) = a 5 and a 1: two columns
  assert.ok(sweep[0].t0 >= lastCall + COIN.sweepAfter, `swept at ${sweep[0].t0}, last bet landed ${lastCall}`);
  assert.equal(new Set(sweep.map((s) => s.land)).size, 1, "all piles land together");
  assert.equal(m.piles.get("pot"), 32);
  assert.equal(m.cues.filter((c) => c.name === "pot").length, 1);
});

test("a check moves no coins; the uncalled bet goes home before the award; the winner counts up", () => {
  const m = hand();
  for (let t = 0; t <= 3600; t += 5) m.tick(t);
  assert.ok(m.cues.some((c) => c.name === "check"));
  assert.equal(m.flights.length, 0, "the check launched nothing");
  let backLand = null, awardT0 = null;
  for (let t = 3600; t <= 12000; t += 1) {
    m.tick(t);
    for (const f of m.flights) {
      if (f.from.kind === "bet" && f.to.kind === "stack") backLand ??= f.t0 + f.dur;
      if (f.from.kind === "pot") awardT0 ??= f.t0;
    }
  }
  assert.ok(backLand != null && awardT0 != null);
  assert.ok(awardT0 >= backLand - COIN.back, "the award waits its turn after the give-back");
  // the count-up: mid-way the badge shows a number between the old and new stack
  const m2 = new Money({ 0: 100 });
  m2.piles.set("pot", 50);
  m2.award([{ seat: 0, amount: 50 }], 0);
  m2.tick(COIN.award + 1);
  const mid = m2.stackAt(0, COIN.award + COIN.count / 2);
  assert.ok(mid > 100 && mid < 150, `mid count ${mid}`);
  assert.equal(m2.stackAt(0, COIN.award + COIN.count + 5), 150);
});

test("a split pot: one share per winner, leaving a beat apart", () => {
  const m = new Money({ 0: 0, 3: 0 });
  m.piles.set("pot", 91);
  m.award([{ seat: 0, amount: 46 }, { seat: 3, amount: 45 }], 0);
  const seen = [];
  for (let t = 0; t <= 2000; t += 1) { m.tick(t); for (const f of m.flights) if (!seen.find((s) => s.id === f.id)) seen.push({ id: f.id, t0: f.t0, seat: f.to.seat, amount: f.amount }); }
  assert.deepEqual(seen.map((s) => [s.seat, s.amount]), [[0, 46], [3, 45]]);
  assert.equal(seen[1].t0 - seen[0].t0, COIN.awardEvery);
  assert.equal(m.stack.get(0) + m.stack.get(3), 91);
});
