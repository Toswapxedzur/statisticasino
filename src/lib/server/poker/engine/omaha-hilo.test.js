// Omaha Hi-Lo: the 8-or-better low evaluator, and a full heads-up hand where the
// pot splits between a high winner and a different low winner.

import test from "node:test";
import assert from "node:assert/strict";
import { bestOmahaLow, compareLowRanks } from "./evaluator.js";
import { standardDeck } from "./cards.js";
import { applyAction, createHand, legalActions } from "./holdem.js";

test("bestOmahaLow finds a qualifying low with exactly 2 hole + 3 board", () => {
  const board = ["2c", "3d", "4h", "Kh", "Qs"];
  const low = bestOmahaLow(["Ah", "6c", "Jc", "Td"], board); // A,6 + 2,3,4
  assert.deepEqual(low.lowRanks, [6, 4, 3, 2, 1]);
});

test("no low when fewer than two hole cards are 8-or-better", () => {
  const board = ["2c", "3d", "4h", "Kh", "Qs"];
  assert.equal(bestOmahaLow(["Kc", "Ks", "9h", "8s"], board), null);
});

test("no low when the board can't supply three low cards", () => {
  assert.equal(bestOmahaLow(["Ah", "2c", "3d", "4h"], ["Kh", "Qs", "Jd", "9c", "8h"]), null);
});

test("the wheel is the best low", () => {
  const wheel = { lowRanks: [5, 4, 3, 2, 1] };
  const sixLow = { lowRanks: [6, 4, 3, 2, 1] };
  assert.ok(compareLowRanks(wheel, sixLow) < 0, "A-2-3-4-5 beats 6-4-3-2-A");
});

// Heads-up (button = seat 1 = SB). Holes are dealt interleaved starting after the
// button (seat 2 first): seat2 = deck[0,2,4,6], seat1 = deck[1,3,5,7]; board =
// deck[8..12]. seat1 → trip kings (high), seat2 → 6-low, so the pot splits.
test("a hi-lo pot splits between the high and low winners", () => {
  const rig = ["Ah", "Kc", "6c", "Ks", "Jc", "9h", "Td", "8s", "2c", "3d", "4h", "Kh", "Qs"];
  const deck = [...rig, ...standardDeck().filter((c) => !rig.includes(c))];
  const players = [{ id: "p1", seat: 1, stack: 100 }, { id: "p2", seat: 2, stack: 100 }];
  let state = createHand({ players, buttonSeat: 1, smallBlind: 5, bigBlind: 10, deck, variant: "omaha-hilo" });

  let guard = 0;
  while (state.street !== "complete") {
    assert.ok(guard++ < 40, "hand terminates");
    const menu = legalActions(state);
    const opt = menu.actions.find((a) => a.type === "check") ?? menu.actions.find((a) => a.type === "call");
    state = applyAction(state, { seat: menu.toActSeat, type: opt.type }).state;
  }

  const payout = new Map(state.payouts.map((p) => [p.seat, p.amount]));
  assert.equal(payout.get(1), 10, "seat 1 takes the high half of the 20 pot");
  assert.equal(payout.get(2), 10, "seat 2 takes the low half");
  const pot = state.result.pots[0];
  assert.deepEqual(pot.winnerSeats, [1], "high winner");
  assert.deepEqual(pot.lowWinnerSeats, [2], "low winner");
});

test("with no qualifying low the high hand scoops", () => {
  // Same board, but seat 2 holds no low (all high cards) → seat 1 wins it all.
  const rig = ["Qh", "Kc", "Jh", "Ks", "9c", "9h", "Ts", "8s", "2c", "3d", "4h", "Kh", "Qs"];
  const deck = [...rig, ...standardDeck().filter((c) => !rig.includes(c))];
  const players = [{ id: "p1", seat: 1, stack: 100 }, { id: "p2", seat: 2, stack: 100 }];
  let state = createHand({ players, buttonSeat: 1, smallBlind: 5, bigBlind: 10, deck, variant: "omaha-hilo" });
  let guard = 0;
  while (state.street !== "complete") {
    assert.ok(guard++ < 40);
    const menu = legalActions(state);
    const opt = menu.actions.find((a) => a.type === "check") ?? menu.actions.find((a) => a.type === "call");
    state = applyAction(state, { seat: menu.toActSeat, type: opt.type }).state;
  }
  const payout = new Map(state.payouts.map((p) => [p.seat, p.amount]));
  assert.equal(payout.get(1), 20, "high scoops the whole pot");
  assert.equal(state.result.pots[0].lowWinnerSeats.length, 0);
});
