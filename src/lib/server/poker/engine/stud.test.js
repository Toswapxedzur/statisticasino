// Seven-Card Stud engine (via the index.js dispatcher): antes + bring-in, five
// streets of up/down cards, showdown on the best 5 of 7, and chip conservation.

import test from "node:test";
import assert from "node:assert/strict";
import { standardDeck } from "./cards.js";
import { createHand, legalActions, applyAction } from "./index.js";
import { pokerStrategy } from "../bot/poker-strategy.js";
import { TIERS } from "../bot/tiers.js";

function makeState(n) {
  const players = Array.from({ length: n }, (_, i) => ({ id: i + 1, seat: i + 1, stack: 100 }));
  return createHand({ players, buttonSeat: 1, smallBlind: 1, bigBlind: 2, deck: standardDeck(), variant: "seven-card-stud" });
}
// Check/call down to showdown; `foldSeat` folds on 3rd street.
function playDown(n, foldSeat = null) {
  let state = makeState(n);
  let guard = 0;
  while (state.street !== "complete") {
    assert.ok(guard++ < 300, "hand terminates");
    const menu = legalActions(state);
    const seat = menu.toActSeat;
    let action;
    if (foldSeat === seat && state.street === "third" && menu.actions.some((a) => a.type === "fold")) action = { seat, type: "fold" };
    else { const o = menu.actions.find((a) => a.type === "check") ?? menu.actions.find((a) => a.type === "call"); action = { seat, type: o.type, amount: o.amount }; }
    state = applyAction(state, action).state;
  }
  return state;
}
const conserved = (state, n) => assert.equal(state.players.reduce((s, p) => s + p.stack, 0), 100 * n);

test("3rd street posts an ante and a bring-in", () => {
  const state = makeState(3);
  assert.equal(state.street, "third");
  assert.equal(state.currentBet, 1, "bring-in = small blind");
  assert.ok(state.initialEvents.some((e) => e.type === "bringIn"));
  assert.ok(state.toActSeat !== null);
  // every player anted (totalCommitted includes the ante; the bring-in has more)
  assert.ok(state.players.every((p) => p.totalCommitted >= 1));
});

test("a full 3-handed hand reaches showdown with chips conserved", () => {
  const state = playDown(3);
  assert.equal(state.street, "complete");
  assert.equal(state.result.type, "showdown");
  conserved(state, 3);
  // each contender ended with a 7-card hand (or 6 + a community river card)
  for (const p of state.players) {
    if (p.status !== "folded") assert.equal(p.holeCards.length + (state.board.length), 7);
  }
});

test("players show four up-cards by the end", () => {
  const state = playDown(3);
  for (const p of state.players) {
    if (p.status !== "folded") assert.equal(p.upCards.length, 4, "3rd–6th street up-cards");
  }
});

test("folding on 3rd street keeps the pot conserved", () => {
  const state = playDown(3, 2);
  assert.equal(state.street, "complete");
  conserved(state, 3);
});

test("heads-up hand also completes and conserves", () => {
  const state = playDown(2);
  assert.equal(state.street, "complete");
  conserved(state, 2);
});

test("the Seven-Card Stud bot value-bets a made hand and folds junk (up-card-aware equity)", () => {
  // A real seeded rng — a constant rng makes the Monte-Carlo sample degenerate.
  let a = 12345 >>> 0;
  const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seats = (mine, oppUp) => ({
    seats: [
      { seat: 1, inHand: true, status: "active", upCards: [] },
      { seat: 2, inHand: true, status: "active", upCards: oppUp }
    ]
  });
  // Trip kings, checked to us against an opponent showing junk → value bet.
  const bet = pokerStrategy.decide({
    view: seats(null, ["2h", "7s", "9d"]), seat: 1, tier: TIERS.reg, rng, variantKey: "seven-card-stud",
    hole: ["Ks", "Kh", "Kd", "5c"],
    turn: { actions: [{ type: "check" }, { type: "bet", min: 2, max: 20 }], callAmount: 0, potTotal: 8 }
  });
  assert.equal(bet.type, "bet");
  // Junk facing a big bet from an opponent already showing a pair of aces → fold.
  const fold = pokerStrategy.decide({
    view: seats(null, ["As", "Ah", "Kd"]), seat: 1, tier: TIERS.reg, rng, variantKey: "seven-card-stud",
    hole: ["3c", "8d", "Jh"],
    turn: { actions: [{ type: "fold" }, { type: "call", amount: 40 }], callAmount: 40, potTotal: 10 }
  });
  assert.equal(fold.type, "fold");
});
