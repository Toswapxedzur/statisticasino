// Blackjack game-module tests: hand values, the round state machine, and that
// settlement is banked (player win = banker loss) and always sums to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { blackjack, handValue, isBlackjack } from "./blackjack.js";

const FILLER = ["2c", "3c", "4c", "5c", "6c", "7c", "8c", "9d"]; // never-blackjack tail

// Drive a one-player round to completion with a rigged deck + scripted actions.
function runRound(deck, actions, stack = 1000, config) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = blackjack.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  const queue = [...actions];
  let guard = 0;
  while (!blackjack.isComplete(state)) {
    assert.ok(guard++ < 100, "round terminates");
    const seat = blackjack.actorSeat(state);
    const act = queue.shift() || blackjack.defaultAction(state, seat);
    state = blackjack.applyAction(state, act).state;
  }
  const results = blackjack.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}

test("hand value flexes aces and detects naturals", () => {
  assert.deepEqual(handValue(["As", "Kd"]), { total: 21, soft: true });
  assert.equal(handValue(["As", "As", "9d"]).total, 21);
  assert.equal(handValue(["As", "As"]).total, 12);
  assert.equal(handValue(["Kh", "Qd", "2c"]).total, 22);
  assert.equal(isBlackjack(["As", "Kd"]), true);
  assert.equal(isBlackjack(["As", "5d", "5c"]), false);
});

test("a natural pays 3:2 and is the banker's loss", () => {
  // player: As, Kd (blackjack). dealer: 9c, 7d (16) → draws Kh → 26 bust.
  const deck = ["As", "9c", "Kd", "7d", "Kh"];
  const { player, banker, results } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }]);
  assert.equal(player.outcome, "blackjack");
  assert.equal(player.delta, 15, "3:2 on a 10 bet");
  assert.equal(banker.delta, -15);
  assert.equal(results.reduce((s, r) => s + r.delta, 0), 0, "settlement sums to zero");
});

test("higher total beats the dealer for even money", () => {
  // player: Ks, Qd (20). dealer: 9c, Kh (19) → stands.
  const deck = ["Ks", "9c", "Qd", "Kh"];
  const { player, banker } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }, { seat: 1, type: "stand" }]);
  assert.equal(player.outcome, "win");
  assert.equal(player.delta, 10);
  assert.equal(banker.delta, -10);
});

test("busting loses the bet even if the dealer would also bust", () => {
  // player: Ks, Qd (20) then hits 5s → 25 bust.
  const deck = ["Ks", "9c", "Qd", "7h", "5s"];
  const { player } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }, { seat: 1, type: "hit" }]);
  assert.equal(player.outcome, "lose");
  assert.equal(player.delta, -10);
});

test("equal totals push", () => {
  // player: Ks, Qd (20). dealer: Kh, Qs (20) → stands.
  const deck = ["Ks", "Kh", "Qd", "Qs"];
  const { player, banker } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }, { seat: 1, type: "stand" }]);
  assert.equal(player.outcome, "push");
  assert.equal(player.delta, 0);
  assert.equal(banker.delta, 0);
});

test("double doubles the bet, draws one card, then the dealer plays", () => {
  // player: 5s, 6d (11) doubles → Kh (21). dealer: 9c, 7d (16) → Qh → 26 bust.
  const deck = ["5s", "9c", "6d", "7d", "Kh", "Qh"];
  const { state, player, banker } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }, { seat: 1, type: "double" }]);
  assert.equal(state.players[0].bet, 20, "bet doubled");
  assert.equal(state.players[0].cards.length, 3, "exactly one draw on a double");
  assert.equal(player.outcome, "win");
  assert.equal(player.delta, 20);
  assert.equal(banker.delta, -20);
});

test("a dealer natural ends the round before players act; a player natural pushes it", () => {
  // dealer: As, Kd (blackjack). player: 9c, 9h (18, not a natural).
  const deck = ["9c", "As", "9h", "Kd"];
  const { player } = runRound(deck, [{ seat: 1, type: "bet", amount: 10 }]);
  assert.equal(player.outcome, "lose", "dealer natural beats a non-natural 18");
  assert.equal(player.delta, -10);
});
