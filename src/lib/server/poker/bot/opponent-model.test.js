// The adaptive opponent model: Beta-Binomial shrinkage, the κ confidence
// coefficient, and the exploit-dial blend. These are deterministic (no RNG).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpponentModel, combineReads, exploitDials } from "./opponent-model.js";
import { TIERS } from "./tiers.js";

// Feed the model `n` copies of one observation — a shorthand for the tests.
function feed(model, id, ev, n) {
  for (let i = 0; i < n; i += 1) model.observe(id, ev);
}

test("an unseen opponent reads as the neutral prior with zero confidence", () => {
  const m = createOpponentModel();
  const r = m.read("nobody");
  assert.equal(r.n, 0);
  assert.equal(r.kappa, 0);
  assert.equal(r.foldToBet, 0.45);
  assert.equal(r.af, 1.0);
  assert.equal(r.vpip, 0.35);
});

test("confidence κ rises with observations (0.5 at CONF_N=20)", () => {
  const m = createOpponentModel();
  feed(m, "x", { action: "call", facingBet: true, vpipChance: true, voluntary: true }, 20);
  const r = m.read("x");
  // 20 observed actions (each call increments both `faced` and `calls`+`n`).
  assert.ok(r.kappa > 0 && r.kappa < 1, "κ strictly between 0 and 1");
  assert.ok(Math.abs(r.kappa - 20 / (20 + 20)) < 1e-9, "κ = n/(n+20)");
});

test("a fold-happy opponent reads as high fold-to-bet; a station as low", () => {
  const foldy = createOpponentModel();
  feed(foldy, "f", { action: "fold", facingBet: true, vpipChance: false, voluntary: false }, 40);
  const station = createOpponentModel();
  feed(station, "s", { action: "call", facingBet: true, vpipChance: true, voluntary: true }, 40);
  assert.ok(foldy.read("f").foldToBet > 0.8, "folds most of the time");
  assert.ok(station.read("s").foldToBet < 0.15, "almost never folds");
  assert.ok(station.read("s").vpip > 0.7, "enters pots very loosely");
});

test("shrinkage keeps a tiny sample near the prior", () => {
  const m = createOpponentModel();
  feed(m, "x", { action: "fold", facingBet: true, vpipChance: false, voluntary: false }, 1);
  const r = m.read("x");
  // One fold out of one: raw would be 1.0, but shrinkage pulls it toward 0.45.
  assert.ok(r.foldToBet < 0.6, `shrunk toward prior, got ${r.foldToBet}`);
  assert.ok(r.kappa < 0.1, "one observation is barely any confidence");
});

test("exploitDials is a no-op without a read, gain, or confidence", () => {
  const r20 = (() => { const m = createOpponentModel(); feed(m, "x", { action: "call", facingBet: true, vpipChance: true, voluntary: true }, 30); return m.read("x"); })();
  assert.equal(exploitDials(TIERS.pro, null), TIERS.pro, "null read → unchanged");
  assert.equal(exploitDials(TIERS.shark, r20), TIERS.shark, "no exploitGain → unchanged");
  const zeroConf = { n: 0, foldToBet: 0.9, af: 2, vpip: 0.9, kappa: 0 };
  assert.equal(exploitDials(TIERS.pro, zeroConf), TIERS.pro, "κ=0 → unchanged");
});

test("exploit: bluff a folder, never a station; value-bet a station thinner", () => {
  const folder = { n: 100, foldToBet: 0.85, af: 1.0, vpip: 0.3, kappa: 0.83 };
  const station = { n: 100, foldToBet: 0.05, af: 0.6, vpip: 0.9, kappa: 0.83 };
  const vsFolder = exploitDials(TIERS.pro, folder);
  const vsStation = exploitDials(TIERS.pro, station);
  assert.ok(vsFolder.bluffFreq > TIERS.pro.bluffFreq, "bluff a folder more");
  assert.ok(vsStation.bluffFreq <= 0.001, "never bluff a station");
  assert.ok(vsStation.valueBetThreshold < TIERS.pro.valueBetThreshold, "value-bet a station thinner");
});

test("exploit NEVER loosens the value-raise margin (the hard-won discipline)", () => {
  for (const read of [
    { n: 100, foldToBet: 0.9, af: 3, vpip: 0.95, kappa: 0.83 },
    { n: 100, foldToBet: 0.1, af: 0.4, vpip: 0.2, kappa: 0.83 }
  ]) {
    assert.equal(exploitDials(TIERS.pro, read).valueRaiseMargin, TIERS.pro.valueRaiseMargin);
  }
});

test("exploit: call down lighter vs a maniac (high aggression factor)", () => {
  const maniac = { n: 100, foldToBet: 0.1, af: 3.0, vpip: 0.8, kappa: 0.83 };
  assert.ok(exploitDials(TIERS.pro, maniac).callSlack > TIERS.pro.callSlack, "more call slack vs a maniac");
});

test("combineReads: empty→null, single→passthrough, many→evidence-weighted", () => {
  assert.equal(combineReads([]), null);
  assert.equal(combineReads([null, null]), null);
  const a = { n: 10, foldToBet: 0.8, af: 2, vpip: 0.6, kappa: 0.33 };
  assert.equal(combineReads([a]), a, "single read passes through");
  const b = { n: 90, foldToBet: 0.2, af: 0.5, vpip: 0.2, kappa: 0.82 };
  const c = combineReads([a, b]);
  assert.equal(c.n, 100);
  // Weighted toward b (far more evidence): fold-to-bet nearer 0.2 than 0.8.
  assert.ok(c.foldToBet < 0.5, `blended fold-to-bet ${c.foldToBet} leans to the larger sample`);
  assert.ok(c.kappa > a.kappa, "combined confidence exceeds the smaller sample's");
});
