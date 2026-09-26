// Sanity tests for the Monte-Carlo equity estimator: it should recover known
// poker facts (aces ~85% heads-up), move the right direction with opponents,
// and be deterministic under a seeded rng.

import { test } from "node:test";
import assert from "node:assert/strict";
import { equity } from "./equity.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("pocket aces are ~85% heads-up preflop", () => {
  const e = equity(["As", "Ah"], [], 1, 4000, mulberry32(1));
  assert.ok(e > 0.80 && e < 0.89, `AA preflop equity ${e} not ~0.85`);
});

test("the worst hand (7-2 offsuit) is a heads-up underdog", () => {
  const e = equity(["2c", "7d"], [], 1, 4000, mulberry32(2));
  assert.ok(e > 0.28 && e < 0.42, `72o preflop equity ${e} out of band`);
});

test("equity drops as opponents multiply", () => {
  const hu = equity(["As", "Ah"], [], 1, 2500, mulberry32(3));
  const multi = equity(["As", "Ah"], [], 5, 2500, mulberry32(3));
  assert.ok(multi < hu, `AA vs 5 (${multi}) should be < heads-up (${hu})`);
  assert.ok(multi > 0.40, `AA vs 5 still a favourite-ish: ${multi}`);
});

test("a made nut flush on the flop is a monster; seeded ⇒ deterministic", () => {
  const e1 = equity(["As", "Ks"], ["Qs", "Js", "2s"], 1, 2000, mulberry32(7));
  const e2 = equity(["As", "Ks"], ["Qs", "Js", "2s"], 1, 2000, mulberry32(7));
  assert.equal(e1, e2, "same seed ⇒ identical equity");
  assert.ok(e1 > 0.85, `made nut flush equity ${e1}`);
});

test("a dry gutshot is a modest underdog, not a favourite", () => {
  // 9-8 on A-J-2 rainbow: no pair, backdoor stuff only.
  const e = equity(["9c", "8d"], ["As", "Jh", "2d"], 1, 2500, mulberry32(11));
  assert.ok(e > 0.05 && e < 0.35, `weak two-overcard-less hand equity ${e}`);
});
