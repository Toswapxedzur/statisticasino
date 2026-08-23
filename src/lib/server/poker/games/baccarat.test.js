// Baccarat + the bet-game factory: Punto Banco outcomes, the Player/Banker/Tie
// payouts (banker commission, 8:1 tie, pushes on a tie), multiple bets, and
// banked settlement summing to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { baccarat } from "./baccarat.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d", "7h"];

// Deal order: player[0], banker[1], player[2], banker[3], then draws.
function runBaccarat(deck, bets, stack = 1000, config) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = baccarat.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  state = baccarat.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(baccarat.isComplete(state), "resolves after the last player bets");
  const results = baccarat.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("a Player natural wins even money", () => {
  const r = runBaccarat(["9s", "5d", "Kh", "2c"], [{ option: "player", amount: 10 }]); // P 9 vs B 7
  assert.equal(r.state.outcome.winner, "player");
  assert.equal(r.player.delta, 10);
  assert.equal(r.banker.delta, -10);
  sumsZero(r);
});

test("a Banker win pays 0.95:1 (5% commission)", () => {
  const r = runBaccarat(["2s", "9d", "3h", "Kc"], [{ option: "banker", amount: 10 }]); // P 5 vs B 9 natural
  assert.equal(r.state.outcome.winner, "banker");
  assert.equal(r.player.delta, 9, "10 × 0.95 → 9");
  sumsZero(r);
});

test("a Tie pays 8:1 and pushes Player/Banker bets", () => {
  const tie = runBaccarat(["8s", "8d", "Ks", "Kh"], [{ option: "tie", amount: 10 }]); // both natural 8
  assert.equal(tie.state.outcome.winner, "tie");
  assert.equal(tie.player.delta, 80);
  const push = runBaccarat(["8s", "8d", "Ks", "Kh"], [{ option: "player", amount: 10 }]);
  assert.equal(push.player.delta, 0, "player bet pushes on a tie");
});

test("multiple bets settle independently", () => {
  const r = runBaccarat(["9s", "5d", "Kh", "2c"], [
    { option: "player", amount: 10 }, // wins +10
    { option: "tie", amount: 5 }       // loses -5
  ]);
  assert.equal(r.player.delta, 5);
  sumsZero(r);
});

test("player draws a third card on 0-5 (drawing rules run)", () => {
  // P: 2,3 = 5 → draws; B: 6,K = 6 → stands (player drew, banker on 6 draws only vs 6/7)
  // player third = filler 2c → P = 2+3+2 = 7; banker stays 6 → player 7 > 6 → player wins.
  const r = runBaccarat(["2s", "6d", "3h", "Kc"], [{ option: "player", amount: 10 }]);
  assert.equal(r.state.outcome.player.cards.length, 3, "player took a third card");
  assert.equal(r.state.outcome.winner, "player");
});
