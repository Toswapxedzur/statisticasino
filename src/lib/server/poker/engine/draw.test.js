// Five-Card Draw engine (via the index.js dispatcher): blinds → betting → draw →
// betting → showdown, plus uncontested folds and safe timeouts during the draw.
// Heads-up deal (button = seat1 = SB): seat2 = deck[0,2,4,6,8], seat1 =
// deck[1,3,5,7,9]; draw replacements come from deck[10..] in draw order.

import test from "node:test";
import assert from "node:assert/strict";
import { standardDeck } from "./cards.js";
import { createHand, legalActions, applyAction } from "./index.js";

// Play a heads-up hand: bets are check/call; the draw uses `drawMap[seat]`.
function play(rig, drawMap = {}, foldSeat = null) {
  const deck = [...rig, ...standardDeck().filter((c) => !rig.includes(c))];
  const players = [{ id: 1, seat: 1, stack: 100 }, { id: 2, seat: 2, stack: 100 }];
  let state = createHand({ players, buttonSeat: 1, smallBlind: 5, bigBlind: 10, deck, variant: "five-card-draw" });
  let guard = 0;
  while (state.street !== "complete") {
    assert.ok(guard++ < 60, "hand terminates");
    const menu = legalActions(state);
    const seat = menu.toActSeat;
    let action;
    if (state.street === "draw") action = { seat, type: "draw", discards: drawMap[seat] || [] };
    else if (foldSeat === seat && menu.actions.some((a) => a.type === "fold") && state.street === "predraw") action = { seat, type: "fold" };
    else { const o = menu.actions.find((a) => a.type === "check") ?? menu.actions.find((a) => a.type === "call"); action = { seat, type: o.type, amount: o.amount }; }
    state = applyAction(state, action).state;
  }
  return state;
}
const stackOf = (state, seat) => state.players.find((p) => p.seat === seat).stack;
const conserved = (state) => assert.equal(state.players.reduce((s, p) => s + p.stack, 0), 200);

test("stand-pat showdown: the better hand wins the pot", () => {
  // seat1 = Ah Kh Qh Jh 9h (flush); seat2 = 2c 4d 6s 8c Tc (ten-high).
  const rig = ["2c", "Ah", "4d", "Kh", "6s", "Qh", "8c", "Jh", "Tc", "9h"];
  const state = play(rig);
  assert.equal(state.result.type, "showdown");
  assert.equal(stackOf(state, 1), 110, "seat1 wins the 20 pot");
  assert.equal(stackOf(state, 2), 90);
  conserved(state);
});

test("drawing completes a royal flush and wins", () => {
  // seat1 = Ah Kh Qh Jh 2c; discards the 2c (index 4) → draws Th (deck[10]).
  const rig = ["8c", "Ah", "8d", "Kh", "2s", "Qh", "3s", "Jh", "4s", "2c", "Th"];
  const state = play(rig, { 1: [4], 2: [] });
  assert.deepEqual(state.players.find((p) => p.seat === 1).holeCards.sort(), ["Ah", "Jh", "Kh", "Qh", "Th"]);
  assert.equal(stackOf(state, 1), 110);
  conserved(state);
});

test("folding pre-draw wins uncontested", () => {
  const rig = ["2c", "Ah", "4d", "Kh", "6s", "Qh", "8c", "Jh", "Tc", "9h"];
  const state = play(rig, {}, 1); // seat1 (SB) folds
  assert.equal(state.result.type, "uncontested");
  assert.equal(state.result.winnerSeat, 2);
  assert.equal(stackOf(state, 2), 105, "wins SB 5; uncalled BB returned");
  conserved(state);
});

test("a non-draw action during the draw is treated as standing pat", () => {
  const rig = ["2c", "Ah", "4d", "Kh", "6s", "Qh", "8c", "Jh", "Tc", "9h"];
  // seat2 "folds" during the draw — must be read as stand-pat, not a fold.
  const deck = [...rig, ...standardDeck().filter((c) => !rig.includes(c))];
  const players = [{ id: 1, seat: 1, stack: 100 }, { id: 2, seat: 2, stack: 100 }];
  let state = createHand({ players, buttonSeat: 1, smallBlind: 5, bigBlind: 10, deck, variant: "five-card-draw" });
  let guard = 0;
  while (state.street !== "complete") {
    assert.ok(guard++ < 60);
    const menu = legalActions(state);
    const seat = menu.toActSeat;
    let action;
    if (state.street === "draw") action = seat === 2 ? { seat, type: "fold" } : { seat, type: "draw", discards: [] };
    else { const o = menu.actions.find((a) => a.type === "check") ?? menu.actions.find((a) => a.type === "call"); action = { seat, type: o.type, amount: o.amount }; }
    state = applyAction(state, action).state;
  }
  assert.equal(state.result.type, "showdown", "both players reached showdown");
  assert.equal(state.result.hands.length, 2);
  conserved(state);
});
