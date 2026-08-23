// Three Card Poker: the 3-card ranking (a straight beats a flush), dealer
// qualification (Queen-high), and banked settlement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { threeCard, rank3 } from "./three-card.js";
import { compareRank } from "./toolkit.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d", "7h"];

// Deal order: player[0,1,2] → dealer[3,4,5].
function runRound(deck, actions, stack = 1000, config) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = threeCard.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  const q = [...actions];
  let g = 0;
  while (!threeCard.isComplete(state)) {
    assert.ok(g++ < 30, "terminates");
    const seat = threeCard.actorSeat(state);
    state = threeCard.applyAction(state, q.shift() || threeCard.defaultAction(state, seat)).state;
  }
  const results = threeCard.settle(state);
  return { results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });

test("3-card ranks: a straight beats a flush", () => {
  const straight = rank3(["9s", "8d", "7c"]);
  const flush = rank3(["Ks", "9s", "2s"]);
  assert.equal(straight.name, "Straight");
  assert.equal(flush.name, "Flush");
  assert.ok(compareRank(straight, flush) > 0, "straight > flush in 3-card");

  assert.equal(rank3(["9s", "8s", "7s"]).name, "Straight Flush");
  assert.equal(rank3(["9s", "9d", "9c"]).name, "Three of a Kind");
  assert.equal(rank3(["As", "2d", "3c"]).name, "Straight", "A-2-3 wheel");
  assert.equal(rank3(["Ks", "9d", "2c"]).name, "High Card");
});

test("play and beat a qualifying dealer pays ante + play", () => {
  // player As Ah Ks (pair of aces); dealer Qd Jc 2h (Q-high, qualifies).
  const deck = ["As", "Ah", "Ks", "Qd", "Jc", "2h"];
  const { player, banker, results } = runRound(deck, [ANTE(10), { seat: 1, type: "play" }]);
  assert.equal(player.outcome, "win");
  assert.equal(player.delta, 20);
  assert.equal(banker.delta, -20);
  assert.equal(results.reduce((s, r) => s + r.delta, 0), 0);
});

test("folding loses the ante; a non-qualifying dealer pays the ante", () => {
  const fold = runRound(["As", "Ah", "Ks", "Qd", "Jc", "2h"], [ANTE(10), { seat: 1, type: "fold" }]);
  assert.equal(fold.player.delta, -10);

  // dealer Js 7d 2c → J-high, does NOT qualify; player plays.
  const nq = runRound(["As", "Ah", "9c", "Js", "7d", "2c"], [ANTE(10), { seat: 1, type: "play" }]);
  assert.equal(nq.player.outcome, "no-qualify");
  assert.equal(nq.player.delta, 10, "ante wins, play pushes");
});
