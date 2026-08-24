// Crazy Eights: a full game plays to a winner who sheds all cards; the pot is the
// antes (no banker) and the per-seat deltas sum to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { crazyEights } from "./crazy-eights.js";
import { standardDeck } from "../engine/cards.js";

// Drive a whole game with the module's own default (play first legal, else draw).
function playOut(nPlayers, deck = standardDeck(), minBet = 10) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ seat: i + 1, userId: `u${i + 1}`, stack: 100 }));
  let state = crazyEights.startRound({ players, bankerSeat: null, deck, config: { minBet } });
  let guard = 0;
  while (!crazyEights.isComplete(state)) {
    assert.ok(guard++ < 3000, "game terminates");
    const seat = crazyEights.actorSeat(state);
    state = crazyEights.applyAction(state, crazyEights.defaultAction(state, seat)).state;
  }
  return state;
}
const sumZero = (state) => assert.equal(state.results.reduce((s, r) => s + r.delta, 0), 0);

test("deals five cards each and a starting discard", () => {
  const state = crazyEights.startRound({ players: [{ seat: 1, userId: "a", stack: 100 }, { seat: 2, userId: "b", stack: 100 }], bankerSeat: null, deck: standardDeck(), config: { minBet: 10 } });
  assert.equal(state.players[0].hand.length, 5);
  assert.equal(state.players[1].hand.length, 5);
  assert.equal(state.discard.length, 1);
  assert.ok(state.toActSeat !== null);
});

test("heads-up game ends with a winner and a conserved pot", () => {
  const state = playOut(2);
  assert.equal(state.phase, "complete");
  assert.ok(state.winner != null);
  const win = state.results.find((r) => r.seat === state.winner);
  assert.equal(win.outcome, "win");
  assert.equal(win.delta, 20 - 10, "winner takes the pot (2×ante) minus their own ante");
  sumZero(state);
});

test("three-handed game also completes and conserves", () => {
  const state = playOut(3);
  assert.equal(state.phase, "complete");
  const win = state.results.find((r) => r.seat === state.winner);
  assert.equal(win.delta, 30 - 10, "pot 3×ante, minus own ante");
  assert.equal(state.results.filter((r) => r.outcome === "lose").length, 2);
  sumZero(state);
});

test("the winner has shed all cards (or fewest if the game locks up)", () => {
  const state = playOut(2);
  const winnerHand = state.players.find((p) => p.seat === state.winner).hand.length;
  const minHand = Math.min(...state.players.map((p) => p.hand.length));
  assert.equal(winnerHand, minHand);
});
