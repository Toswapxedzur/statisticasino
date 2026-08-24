// Run-it-twice: an all-in with cards to come deals the remaining board N times and
// splits every pot across the runs. The load-bearing property is CHIP CONSERVATION
// (slices always sum back to the pot); we also check the split is decided per-board.

import test from "node:test";
import assert from "node:assert/strict";
import { standardDeck } from "./cards.js";
import { applyAction, createHand, legalActions } from "./holdem.js";

function rigged(prefix) {
  const used = new Set(prefix);
  return [...prefix, ...standardDeck().filter((c) => !used.has(c))];
}
function make({ stacks, bb = 10, ante = 0, runItTwice = true, deck } = {}) {
  return createHand({
    players: stacks.map((s, i) => ({ id: `p${i + 1}`, seat: i + 1, stack: s })),
    buttonSeat: 1, smallBlind: bb / 2, bigBlind: bb, ante, runItTwice, deck: deck || standardDeck()
  });
}
const total = (st) => st.players.reduce((s, p) => s + p.stack, 0);
const stackOf = (st, seat) => st.players.find((p) => p.seat === seat).stack;

// Drive everyone all-in preflop (all-in if legal, else call), returning the
// completed state.
function shoveAll(st) {
  let guard = 0;
  while (st.street !== "complete" && st.toActSeat != null) {
    assert.ok(guard++ < 40, "terminates");
    const menu = legalActions(st);
    const a = menu.actions.find((x) => x.type === "allin")
      || menu.actions.find((x) => x.type === "call")
      || menu.actions.find((x) => x.type === "check");
    st = applyAction(st, { seat: menu.toActSeat, type: a.type }).state;
  }
  return st;
}

test("heads-up all-in runs twice: two distinct boards, chips conserved", () => {
  const st = shoveAll(make({ stacks: [100, 100] }));
  assert.equal(st.street, "complete");
  assert.equal(st.result.type, "showdown");
  assert.equal(st.result.runItTwice, true);
  assert.equal(st.result.runs.length, 2, "two runs");
  assert.notDeepEqual(st.result.runs[0].board, st.result.runs[1].board, "the two boards differ");
  assert.equal(total(st), 200, "chips conserved");
});

test("a player who wins BOTH boards takes the whole pot", () => {
  // HU deal order (button=1): deck[0]=seat2 c1, [1]=seat1 c1, [2]=seat2 c2, [3]=seat1 c2.
  // seat1 = AsAh, seat2 = KsKh; neither board pairs the king or makes seat2 ahead.
  const deck = rigged([
    "Ks", "As", "Kh", "Ah",
    "2c", "3d", "7h", "9s", "Tc",   // run 1 board
    "2s", "3h", "8h", "Js", "Qc"    // run 2 board (still no King, no straight/flush)
  ]);
  const st = shoveAll(make({ stacks: [100, 100], deck }));
  assert.equal(stackOf(st, 1), 200, "seat1 (aces) scoops both runs");
  assert.equal(stackOf(st, 2), 0);
  assert.equal(total(st), 200);
});

test("split boards split the pot (each wins one run)", () => {
  // Same holes, but run 2 gives seat2 a set of kings.
  const deck = rigged([
    "Ks", "As", "Kh", "Ah",
    "2c", "3d", "7h", "9s", "Tc",   // run 1: seat1 aces win
    "Kc", "6d", "8h", "Js", "Qc"    // run 2: seat2 makes trip kings
  ]);
  const st = shoveAll(make({ stacks: [100, 100], deck }));
  assert.equal(stackOf(st, 1), 100, "each player takes one 100-chip half");
  assert.equal(stackOf(st, 2), 100);
  assert.equal(total(st), 200);
});

test("odd/side-potted all-ins still conserve every chip across runs", () => {
  // Unequal all-ins (main + side pots) and an ante to force non-even totals.
  for (const stacks of [[33, 100, 100], [50, 75, 100], [37, 91, 143]]) {
    const st = shoveAll(make({ stacks, ante: 1 }));
    assert.equal(st.street, "complete");
    assert.equal(st.result.runItTwice, true);
    assert.equal(total(st), stacks.reduce((a, b) => a + b, 0), `conserved for ${stacks}`);
  }
});

test("run-it-twice off deals a single board", () => {
  const st = shoveAll(make({ stacks: [100, 100], runItTwice: false }));
  assert.equal(st.result.type, "showdown");
  assert.ok(!st.result.runItTwice, "not flagged run-it-twice");
  assert.equal(st.result.runs, undefined, "no runs array");
  assert.equal(total(st), 200);
});
