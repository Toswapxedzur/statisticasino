// Validates the self-play harness (and, transitively, that the tiers differ in
// strength): the tight-aggressive "reg" should beat the loose-passive "fish".

import { test } from "node:test";
import assert from "node:assert/strict";
import { playMatch, duplicateEdge } from "./selfplay.js";
import { TIERS, TEST_TIERS } from "./tiers.js";

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

// The adaptive "pro" should out-earn the STATIC "shark" against exploitable
// opponents — that's the whole point of the opponent model. Measured card-matched
// (duplicateEdge) so the delta is the exploit, not variance; fully seeded, so the
// edge is exactly reproducible (no flake). Against a loose-passive fish it value-
// bets thinner; against a loose-aggressive maniac it calls down lighter and stops
// spewing thin value — both net positive over the static baseline.
test("the adaptive pro out-exploits the static shark vs a loose-passive fish", () => {
  const { edge } = duplicateEdge({ heroTier: fast(TIERS.pro), baselineTier: fast(TIERS.shark), villainTier: fast(TIERS.fish), hands: 200 });
  assert.ok(edge > 0, `pro should out-earn shark vs fish (edge ${edge})`);
});

test("the adaptive pro out-exploits the static shark vs a loose-aggressive maniac", () => {
  const { edge } = duplicateEdge({ heroTier: fast(TIERS.pro), baselineTier: fast(TIERS.shark), villainTier: fast(TEST_TIERS.maniac), hands: 200 });
  assert.ok(edge > 0, `pro should out-earn shark vs maniac (edge ${edge})`);
});

test("with no opponent read, the pro plays exactly like the shark (no free lunch)", () => {
  // Heads-up hand 0, first decision: neither has any observations yet, so κ=0 and
  // the exploit is a no-op — pro and shark must choose identically.
  const proNet = playMatch({ tiers: [fast(TIERS.pro), fast(TIERS.fish)], hands: 1, seed: 11 });
  const sharkNet = playMatch({ tiers: [fast(TIERS.shark), fast(TIERS.fish)], hands: 1, seed: 11 });
  assert.deepEqual(proNet, sharkNet, "first hand (no read) is identical to the shark");
});
