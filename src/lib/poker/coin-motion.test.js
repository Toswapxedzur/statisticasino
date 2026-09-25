import { test } from "node:test";
import assert from "node:assert/strict";
import { Money, COIN, breakdown, DENOMS, radix } from "./coin-motion.js";

const total = (m) => [...m.stack.values()].reduce((a, b) => a + b, 0)
  + [...m.piles.keys()].reduce((a, k) => a + m.amountOf(k), 0)
  + m.flights.filter((f) => !f.landed).reduce((a, f) => a + f.amount, 0);
// every landed column below its radix = the pile reads as one proper number
const canonical = (m, pile) => m.columnsOf(pile).every(([d, n]) => n < radix(d));

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
const run = (m, from, to, step, each) => { for (let t = from; t <= to; t += step) { m.tick(t); each?.(t); } };

test("breakdown: the amount as digits, highest coin first, each below its radix", () => {
  assert.deepEqual(breakdown(1234), [{ denom: 500, count: 2 }, { denom: 100, count: 2 }, { denom: 25, count: 1 }, { denom: 5, count: 1 }, { denom: 1, count: 4 }]);
  for (const n of [1, 7, 99, 2600, 1_234_567]) {
    assert.equal(breakdown(n).reduce((a, c) => a + c.denom * c.count, 0), n);
    assert.ok(breakdown(n).every((c) => c.count < radix(c.denom)));
  }
  assert.deepEqual(DENOMS.slice(0, -1).map((d) => radix(DENOMS[DENOMS.indexOf(d) + 1])), [5, 4, 5, 5, 4, 5, 5, 4, 5, 5]);
});

test("money is conserved at every moment of a hand, and every pile ends as a proper number", () => {
  const m = hand(), start = total(m);
  run(m, 0, 14000, 5, (t) => assert.equal(total(m), start, `at ${t} ms`));
  assert.equal(m.flights.length, 0);
  assert.equal(m.amountOf("pot"), 0);
  assert.equal(m.stack.get(5), 200 - 8 - 60 + 152);
  assert.equal(m.stack.get(4), 200 - 8 - 20 - 40);
});

test("a bet leaves in columns, highest first, each landing on its own column", () => {
  const m = new Money({ 3: 1000 });
  m.bet(3, 137, 0);                    // 100 + 25 + 5 + 7×1; five of the 1s then carry into a 5
  m.tick(1);
  assert.equal(m.flights[0].denom, 100);
  assert.equal(m.stackAt(3, 1), 900, "the badge drops as a column leaves");
  m.tick(3 * COIN.every + 1);
  assert.deepEqual(m.flights.map((f) => [f.denom, f.to.denom]), [[100, 100], [25, 25], [5, 5], [1, 1]]);
  run(m, 3 * COIN.every + 2, 2000, 1);
  assert.equal(m.amountOf("bet:3"), 137);
  assert.deepEqual(m.columnsOf("bet:3"), [[100, 1], [25, 1], [5, 2], [1, 2]], "7 coppers carried: 5 of them became a brass");
  assert.equal(m.cues.filter((c) => c.name === "bet").length, 1, "one chip sound per bet, on landing");
});

test("carry: coins reaching their radix merge into one coin of the next value, and chain", () => {
  const m = new Money({ 0: 1000 });
  m.bet(0, 24, 0);                     // 5×4 + 1×4
  run(m, 0, 1000, 1);
  assert.deepEqual(m.columnsOf("bet:0"), [[5, 4], [1, 4]]);
  m.bet(0, 1, 1000);                   // 25: the 1s reach 5 → a 5 → the 5s reach 5 → a 25
  const merges = [];
  run(m, 1000, 3000, 1, () => { for (const f of m.flights) if (f.kind === "merge" && !merges.includes(f)) merges.push(f); });
  assert.deepEqual(merges.map((f) => [f.denom, f.count, f.toDenom]), [[1, 5, 5], [5, 5, 25]]);
  assert.ok(merges[1].t0 >= merges[0].t0 + COIN.merge, "the second carry follows the first");
  assert.deepEqual(m.columnsOf("bet:0"), [[25, 1]]);
});

test("the sweep: each column flies to the pot's same-value column, all landing together; the pot then carries", () => {
  const m = hand();
  let sweep = null;
  run(m, 0, 3900, 1, () => {
    const s = m.flights.filter((f) => f.to.pile === "pot" && f.kind === "column");
    if (s.length && !sweep) sweep = s.map((f) => ({ t0: f.t0, land: f.t0 + f.dur, d: f.denom, to: f.to.denom }));
  });
  assert.ok(sweep.every((s) => s.d === s.to), "digit-wise");
  const lastCall = 2000 + COIN.every + COIN.flight;   // bet(2, 6) = a 5 and a 1: two columns
  assert.ok(sweep[0].t0 >= lastCall + COIN.sweepAfter, `swept at ${sweep[0].t0}, last bet landed ${lastCall}`);
  assert.equal(new Set(sweep.map((s) => s.land)).size, 1, "all piles land together");
  assert.equal(m.amountOf("pot"), 32);
  assert.ok(canonical(m, "pot"), JSON.stringify(m.columnsOf("pot")));
  assert.deepEqual(m.columnsOf("pot"), [[25, 1], [5, 1], [1, 2]]);
  assert.equal(m.cues.filter((c) => c.name === "pot").length, 1);
  assert.equal(m.sweeps.length, 4);
});

test("borrow: dividing a pile breaks a bigger coin where a digit is short, then the share leaves", () => {
  const m = new Money({ 0: 0, 3: 0 });
  m._add("pot", 100, 2, 0); m._add("pot", 25, 1, 0); m._add("pot", 5, 3, 0); m._add("pot", 1, 2, 0);   // 242
  run(m, 0, 200, 1);
  m.award([{ seat: 0, amount: 121 }, { seat: 3, amount: 121 }], 300);
  const seen = [];
  run(m, 300, 6000, 1, () => { for (const f of m.flights) if (!seen.includes(f)) seen.push(f); });
  const breaks = seen.filter((f) => f.kind === "break").map((f) => [f.denom, f.toDenom, f.toCount]);
  const home = seen.filter((f) => f.to.kind === "stack");
  // share 1 = 100+ 5×4 + 1: a 25 breaks into five 5s; share 2 = the same from what's left
  assert.ok(breaks.length >= 1, JSON.stringify(breaks));
  assert.deepEqual(home.filter((f) => f.to.seat === 0).map((f) => [f.denom, f.count]), [[100, 1], [5, 4], [1, 1]]);
  assert.equal(m.stack.get(0), 121);
  assert.equal(m.stack.get(3), 121);
  assert.equal(m.amountOf("pot"), 0);
});

test("a check moves no coins; the uncalled bet goes home before the award; the winner counts up", () => {
  const m = hand();
  run(m, 0, 3600, 5);
  assert.ok(m.cues.some((c) => c.name === "check"));
  let backT0 = null, awardT0 = null;
  run(m, 3601, 14000, 1, () => {
    for (const f of m.flights) {
      if (f.from.pile === "bet:5" && f.to.kind === "stack") backT0 ??= f.t0;
      if (f.from.pile === "pot" && f.to.kind === "stack") awardT0 ??= f.t0;
    }
  });
  assert.ok(backT0 != null && awardT0 != null && awardT0 >= backT0);
  const m2 = new Money({ 0: 100 });
  m2._add("pot", 25, 2, 0);
  m2.award([{ seat: 0, amount: 50 }], 0);
  let land = null;
  run(m2, 0, 3000, 1, () => { for (const f of m2.flights) if (f.to.kind === "stack") land ??= f.t0 + f.dur; });
  assert.equal(m2.stack.get(0), 150);
  const mid = m2.stackAt(0, land + COIN.count / 2);
  assert.ok(mid > 100 && mid < 150, `half-way through the count-up the badge reads ${mid}`);
  assert.equal(m2.stackAt(0, land + COIN.count + 1), 150);
});

test("a bet that empties the stack cues all-in (and no ordinary coin clicks)", () => {
  const m = new Money({ 1: 40, 2: 100 });
  m.bet(1, 40, 0); m.bet(2, 40, 0);
  run(m, 0, 2000, 1);
  assert.deepEqual(m.cues.filter((c) => c.name === "allIn").map((c) => c.at.seat), [1]);
  assert.ok(!m.cues.some((c) => c.name === "coins" && c.at.pile === "bet:1"), "the all-in plays instead of clicks");
  assert.ok(m.cues.some((c) => c.name === "coins" && c.at.pile === "bet:2"));
});
