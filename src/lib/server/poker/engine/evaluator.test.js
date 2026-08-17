import test from "node:test";
import assert from "node:assert/strict";

import { compareRank, evaluate7 } from "./evaluator.js";

test("evaluate7 recognizes every category and selects the best five cards", () => {
  const cases = [
    [["As", "Kd", "9c", "7h", "4s", "3d", "2c"], 0, [14, 13, 9, 7, 4], "High Card"],
    [["As", "Ad", "Kc", "9h", "7s", "4d", "2c"], 1, [14, 13, 9, 7], "One Pair"],
    [["As", "Ad", "Kc", "Kh", "7s", "4d", "2c"], 2, [14, 13, 7], "Two Pair"],
    [["As", "Ad", "Ac", "Kh", "7s", "4d", "2c"], 3, [14, 13, 7], "Three of a Kind"],
    [["As", "Kd", "Qc", "Jh", "Ts", "4d", "2c"], 4, [14], "Straight"],
    [["As", "Js", "9s", "6s", "3s", "Kd", "2c"], 5, [14, 11, 9, 6, 3], "Flush"],
    [["As", "Ad", "Ac", "Kh", "Ks", "Kd", "2c"], 6, [14, 13], "Full House"],
    [["As", "Ad", "Ac", "Ah", "Ks", "Kd", "2c"], 7, [14, 13], "Four of a Kind"],
    [["9s", "8s", "7s", "6s", "5s", "Ad", "Ac"], 8, [9], "Straight Flush"]
  ];

  for (const [cards, category, ranks, name] of cases) {
    assert.deepEqual(evaluate7(cards), { category, ranks, name });
  }
});

test("wheel and steel wheel use five as the straight high card", () => {
  assert.deepEqual(evaluate7(["As", "2d", "3c", "4h", "5s", "Kd", "Qc"]), {
    category: 4,
    ranks: [5],
    name: "Straight"
  });
  assert.deepEqual(evaluate7(["As", "2s", "3s", "4s", "5s", "Kd", "Qc"]), {
    category: 8,
    ranks: [5],
    name: "Straight Flush"
  });
});

test("compareRank compares category and then kickers in ascending strength order", () => {
  const weakPair = evaluate7(["2s", "2d", "Ac", "Kh", "9s", "4d", "3c"]);
  const strongPair = evaluate7(["3s", "3d", "Ac", "Kh", "9s", "4d", "2c"]);
  const sameStrongPair = evaluate7(["3c", "3h", "Ad", "Ks", "9c", "4h", "2d"]);
  const straight = evaluate7(["As", "Kd", "Qc", "Jh", "Ts", "4d", "2c"]);

  assert.ok(compareRank(weakPair, strongPair) < 0);
  assert.ok(compareRank(straight, strongPair) > 0);
  assert.equal(compareRank(strongPair, sameStrongPair), 0);
});

test("evaluate7 rejects malformed or duplicate cards", () => {
  assert.throws(() => evaluate7(["As"]), /exactly 7/);
  assert.throws(
    () => evaluate7(["As", "As", "2c", "3d", "4h", "5s", "6c"]),
    /duplicate card/
  );
  assert.throws(
    () => evaluate7(["AX", "Ks", "2c", "3d", "4h", "5s", "6c"]),
    /invalid card/
  );
});
