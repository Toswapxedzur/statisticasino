// Validates the self-play harness (and, transitively, that the tiers differ in
// strength): the tight-aggressive "reg" should beat the loose-passive "fish".

import { test } from "node:test";
import assert from "node:assert/strict";
import { playMatch } from "./selfplay.js";
import { TIERS } from "./tiers.js";

const fast = (t) => ({ ...t, iters: 24 }); // fewer Monte-Carlo iters keeps the test quick

test("reg beats fish heads-up over many hands", () => {
  const net = playMatch({ tiers: [fast(TIERS.reg), fast(TIERS.fish)], hands: 240, seed: 7 });
  assert.equal(net[0] + net[1], 0, "heads-up is zero-sum");
  assert.ok(net[0] > net[1], `reg (${net[0]}) should beat fish (${net[1]})`);
});

test("the range-aware shark beats reg", () => {
  let net = 0;
  for (const seed of [7, 42]) net += playMatch({ tiers: [fast(TIERS.shark), fast(TIERS.reg)], hands: 200, seed })[0];
  assert.ok(net > 0, `shark should beat reg over the sample (net ${net})`);
});

test("the harness runs Omaha Hi-Lo without error and conserves chips", () => {
  const net = playMatch({ tiers: [fast(TIERS.reg), fast(TIERS.reg)], hands: 24, seed: 3, variant: "omaha-hilo" });
  assert.equal(net.length, 2);
  assert.equal(net[0] + net[1], 0);
});
