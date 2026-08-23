// Dragon Tiger: higher card wins (Ace low), Tie pays 8:1 and takes half of any
// Dragon/Tiger bet, banked settlement sums to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dragonTiger } from "./dragon-tiger.js";

const FILLER = ["2c", "3c", "4h", "5s"];
function play(deck, bets, stack = 1000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = dragonTiger.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = dragonTiger.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(dragonTiger.isComplete(state));
  const results = dragonTiger.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("Dragon wins on the higher card", () => {
  const r = play(["Ks", "2h"], [{ option: "dragon", amount: 10 }]); // K vs 2
  assert.equal(r.state.outcome.winner, "dragon");
  assert.equal(r.player.delta, 10);
  assert.equal(play(["Ks", "2h"], [{ option: "tiger", amount: 10 }]).player.delta, -10);
  sumsZero(r);
});

test("Tiger wins on the higher card; Ace is low", () => {
  const r = play(["As", "5h"], [{ option: "tiger", amount: 10 }]); // A(1) vs 5 → tiger
  assert.equal(r.state.outcome.winner, "tiger");
  assert.equal(r.player.delta, 10);
});

test("a tie pays the Tie bet 8:1 and takes half of Dragon/Tiger", () => {
  const tie = play(["7s", "7h"], [{ option: "tie", amount: 10 }]);
  assert.equal(tie.state.outcome.winner, "tie");
  assert.equal(tie.player.delta, 80);
  const half = play(["7s", "7h"], [{ option: "dragon", amount: 10 }]);
  assert.equal(half.player.delta, -5, "half the Dragon bet is lost on a tie");
  sumsZero(half);
});

test("multiple bets settle independently", () => {
  const r = play(["Ks", "2h"], [{ option: "dragon", amount: 10 }, { option: "tie", amount: 5 }]);
  assert.equal(r.player.delta, 5); // +10 dragon, -5 tie
  sumsZero(r);
});
