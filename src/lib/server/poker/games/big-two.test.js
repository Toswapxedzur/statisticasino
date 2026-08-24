// Big Two: combo classification + comparison (2 high, suit tiebreak, poker 5-card
// hands), the opening-card rule, a full game to a conserved pot, and the bot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bigTwo, classifyPlay, comparePlay } from "./big-two.js";
import { bigTwoStrategy } from "../bot/big-two-strategy.js";
import { standardDeck } from "../engine/cards.js";

test("classifyPlay accepts legal combos and rejects the rest", () => {
  assert.equal(classifyPlay(["3d"]).size, 1);
  assert.equal(classifyPlay(["5h", "5s"]).size, 2);
  assert.equal(classifyPlay(["5h", "6s"]), null, "mismatched pair");
  assert.equal(classifyPlay(["7c", "7d", "7h"]).size, 3);
  assert.equal(classifyPlay(["3d", "4d", "5d", "6d", "7d"]).size, 5, "straight flush");
  assert.equal(classifyPlay(["3d", "4d", "5d", "6d", "8d"]).size, 5, "flush");
  assert.equal(classifyPlay(["3d", "3h", "3c", "3s", "9d"]).size, 5, "quads");
  assert.equal(classifyPlay(["3d", "3h", "5c", "6d", "8s"]), null, "one pair is not a 5-card play");
  assert.equal(classifyPlay(["3d", "4d", "5d", "6d"]), null, "four cards");
});

test("comparePlay: 2 is the highest single, suits break ties, poker order for fives", () => {
  assert.ok(comparePlay(classifyPlay(["2d"]), classifyPlay(["Ad"])) > 0, "2 beats A");
  assert.ok(comparePlay(classifyPlay(["5s"]), classifyPlay(["5d"])) > 0, "spade beats diamond");
  assert.ok(comparePlay(classifyPlay(["Kh", "Ks"]), classifyPlay(["Qh", "Qs"])) > 0, "higher pair");
  const sf = classifyPlay(["3d", "4d", "5d", "6d", "7d"]);
  const flush = classifyPlay(["2c", "5c", "8c", "9c", "Jc"]);
  assert.ok(comparePlay(sf, flush) > 0, "straight flush beats flush");
});

// Drive a 4-handed game with the module default (followers pass; leader dumps
// singles) — degenerate but it terminates and settles.
test("a full game ends with a winner and a conserved pot", () => {
  const players = [1, 2, 3, 4].map((n) => ({ seat: n, userId: `u${n}`, stack: 100 }));
  let state = bigTwo.startRound({ players, bankerSeat: null, deck: standardDeck(), config: { minBet: 5 } });
  let guard = 0;
  while (!bigTwo.isComplete(state)) {
    assert.ok(guard++ < 4000, "terminates");
    const seat = bigTwo.actorSeat(state);
    state = bigTwo.applyAction(state, bigTwo.defaultAction(state, seat)).state;
  }
  assert.ok(state.winner != null);
  const win = state.results.find((r) => r.seat === state.winner);
  assert.equal(win.delta, 4 * 5 - 5, "pot 4×ante minus own ante");
  assert.equal(state.results.reduce((s, r) => s + r.delta, 0), 0, "conserved");
});

test("the opening play must include the lowest card", () => {
  const players = [1, 2].map((n) => ({ seat: n, userId: `u${n}`, stack: 100 }));
  const state = bigTwo.startRound({ players, bankerSeat: null, deck: standardDeck(), config: { minBet: 5 } });
  const opener = state.toActSeat;
  const p = state.players.find((x) => x.seat === opener);
  const notLowest = p.hand.find((c) => c !== state.lowestCard);
  assert.throws(() => bigTwo.applyAction(state, { seat: opener, type: "play", cards: [notLowest] }), /opening play must include/);
});

test("the bot plays the weakest beating combo, else passes", () => {
  const beat = bigTwoStrategy.decide({ turn: { shedGame: true, combo: true, hand: ["3c", "7d", "Ah"], pileCards: ["5d"] } });
  assert.deepEqual(beat, { type: "play", cards: ["7d"] }, "lowest single that beats 5d");
  const pass = bigTwoStrategy.decide({ turn: { shedGame: true, combo: true, hand: ["3c", "4c"], pileCards: ["Ks"] } });
  assert.deepEqual(pass, { type: "pass" });
});
