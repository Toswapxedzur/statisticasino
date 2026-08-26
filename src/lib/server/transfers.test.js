// The anti-mule transfer rule: only game-earned chips are transferable, received
// chips can't be re-forwarded, and you can never send more than you hold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { transferableFrom } from "./transfers.js";

test("a mule farming free rewards can send nothing", () => {
  // earned 0 (only signup + daily bonuses), big balance -> 0 transferable.
  assert.equal(transferableFrom(0, 0, 12_000), 0);
});

test("game winnings are transferable", () => {
  assert.equal(transferableFrom(5_000, 0, 12_000), 5_000);
});

test("already-sent winnings reduce what's left", () => {
  assert.equal(transferableFrom(5_000, 2_000, 12_000), 3_000);
});

test("received chips (which raise balance but not earned) can't be re-forwarded", () => {
  // A pure receiver: earned 0, balance inflated by receipts -> still 0.
  assert.equal(transferableFrom(0, 0, 50_000), 0);
});

test("never more than the current balance", () => {
  // Won 5k but lost most of it back at the tables (balance 1k) -> capped at 1k.
  assert.equal(transferableFrom(5_000, 0, 1_000), 1_000);
});

test("a net loser can send nothing", () => {
  assert.equal(transferableFrom(-3_000, 0, 8_000), 0);
});
