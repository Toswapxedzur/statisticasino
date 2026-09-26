// Tests for the Hold'em variant descriptor: it validates its deck, and a hand plays to completion with
// chips conserved. (The Omaha / Short Deck / Pot-Limit tests went with those variants, 2026-09-26.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { standardDeck, shuffle } from "./cards.js";
import { createHand, legalActions, applyAction } from "./holdem.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- decks

test("Hold'em validates its deck", () => {
  const players = [{ id: 0, seat: 0, stack: 100 }, { id: 1, seat: 1, stack: 100 }];
  const cfg = { players, buttonSeat: 0, smallBlind: 1, bigBlind: 2 };
  const h = createHand({ ...cfg, variant: "holdem", deck: standardDeck() });
  assert.equal(h.players[0].holeCards.length, 2);
  assert.throws(() => createHand({ ...cfg, variant: "holdem", deck: standardDeck().slice(0, 40) }), /full 52-card/);
});

// ---------------------------------------------------------------- end to end

// Auto-play a heads-up hand to showdown (both just call/check) and assert the
// hand completes and chips are conserved.
function playToEnd(variant, deckFn, seed) {
  const start = 200;
  let hand = createHand({
    variant,
    players: [{ id: 0, seat: 0, stack: start }, { id: 1, seat: 1, stack: start }],
    buttonSeat: 0, smallBlind: 1, bigBlind: 2,
    deck: shuffle(deckFn(), mulberry32(seed))
  });
  let guard = 0;
  while (hand.toActSeat !== null) {
    assert.ok(guard++ < 500, `${variant} hand terminates`);
    const menu = legalActions(hand);
    const act = menu.actions.find((a) => a.type === "check")
      || menu.actions.find((a) => a.type === "call")
      || { type: "fold" };
    hand = applyAction(hand, { seat: hand.toActSeat, ...act }).state;
  }
  assert.equal(hand.street, "complete", `${variant} reaches completion`);
  const total = hand.players.reduce((sum, p) => sum + p.stack, 0);
  assert.equal(total, 2 * start, `${variant} conserves chips`);
}

test("Hold'em plays a full hand to completion, chips conserved", () => {
  for (const seed of [1, 2, 3]) playToEnd("holdem", standardDeck, seed);
});
