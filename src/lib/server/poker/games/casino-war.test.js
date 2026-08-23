// Casino War: Player vs Dealer high card (Ace high), even money, Player pushes on
// a tie, Tie side bet pays 10:1, banked settlement sums to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { casinoWar } from "./casino-war.js";

const FILLER = ["2c", "3c", "4h", "5s"];
function play(deck, bets, stack = 1000) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = casinoWar.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER] });
  state = casinoWar.applyAction(state, { seat: 1, type: "bet", bets }).state;
  assert.ok(casinoWar.isComplete(state));
  const results = casinoWar.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const sumsZero = (r) => assert.equal(r.results.reduce((s, x) => s + x.delta, 0), 0);

test("Player beats the Dealer even money", () => {
  const r = play(["Ks", "2h"], [{ option: "ante", amount: 10 }]);
  assert.equal(r.state.outcome.winner, "player");
  assert.equal(r.player.delta, 10);
  sumsZero(r);
});

test("Player loses to a higher Dealer card", () => {
  assert.equal(play(["2s", "Kh"], [{ option: "ante", amount: 10 }]).player.delta, -10);
});

test("Ace is high", () => {
  assert.equal(play(["As", "Kh"], [{ option: "ante", amount: 10 }]).player.delta, 10, "A beats K");
});

test("a tie pushes the Player bet and pays the Tie bet 10:1", () => {
  const push = play(["9s", "9h"], [{ option: "ante", amount: 10 }]);
  assert.equal(push.state.outcome.winner, "tie");
  assert.equal(push.player.delta, 0);
  assert.equal(play(["9s", "9h"], [{ option: "tie", amount: 10 }]).player.delta, 100);
});
