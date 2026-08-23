// Tests for the poker variants: short-deck rank ordering, Omaha's exactly-2+3
// rule, pot-limit bet sizing, per-variant deck validation, and that every
// variant plays a full hand to completion with chips conserved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { standardDeck, shortDeck, shuffle } from "./cards.js";
import { bestHand, bestOmaha, compareRank, STANDARD_MODEL, SHORTDECK_MODEL } from "./evaluator.js";
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

// ---------------------------------------------------------------- short deck

test("short deck floats a flush above a full house (and reverses under standard)", () => {
  const flushCards = ["As", "Ks", "Qs", "9s", "6s", "7d", "8h"]; // five spades
  const boatCards = ["Ac", "Ah", "Ad", "Kc", "Kd", "6h", "7s"];  // AAA KK

  const flushSD = bestHand(flushCards, SHORTDECK_MODEL);
  const boatSD = bestHand(boatCards, SHORTDECK_MODEL);
  assert.equal(flushSD.name, "Flush");
  assert.equal(boatSD.name, "Full House");
  assert.ok(compareRank(flushSD, boatSD) > 0, "short deck: flush beats full house");

  const flushStd = bestHand(flushCards, STANDARD_MODEL);
  const boatStd = bestHand(boatCards, STANDARD_MODEL);
  assert.ok(compareRank(boatStd, flushStd) > 0, "standard: full house beats flush");
});

test("short deck treats A-6-7-8-9 as a 9-high straight; standard does not", () => {
  const cards = ["Ah", "6c", "7d", "8s", "9h", "Kc", "Qd"];
  const sd = bestHand(cards, SHORTDECK_MODEL);
  assert.equal(sd.name, "Straight");
  assert.equal(sd.ranks[0], 9, "the wheel is 9-high");

  const std = bestHand(cards, STANDARD_MODEL);
  assert.notEqual(std.name, "Straight", "A-6-7-8-9 is not a straight in a 52-card deck");
});

// ---------------------------------------------------------------- omaha 2+3

test("Omaha must use EXACTLY two hole cards — a board flush does not play", () => {
  const hole = ["As", "Ah", "2c", "3d"];       // only one spade
  const board = ["Ks", "Qs", "Js", "Ts", "9s"]; // a straight flush on the board
  const naive = bestHand([...hole, ...board]);   // best-5-of-9 would just play the board
  const omaha = bestOmaha(hole, board);
  assert.equal(naive.name, "Straight Flush", "the board alone is a straight flush");
  assert.equal(omaha.name, "One Pair", "Omaha can't reach it with only one hole spade");
});

test("Omaha 2+3 finds a made flush that uses two hole cards", () => {
  const hole = ["Ac", "Kc", "2d", "3h"];        // two clubs
  const board = ["Qc", "Jc", "Tc", "5s", "6h"]; // three clubs
  const omaha = bestOmaha(hole, board);
  assert.equal(omaha.name, "Straight Flush", "Ac Kc + Qc Jc Tc = royal");
  assert.equal(omaha.ranks[0], 14);
});

// ---------------------------------------------------------------- pot-limit

test("pot-limit caps the opening raise at pot size; no-limit allows the stack", () => {
  const players = [{ id: 0, seat: 0, stack: 1000 }, { id: 1, seat: 1, stack: 1000 }];
  const cfg = { players, buttonSeat: 0, smallBlind: 1, bigBlind: 2 };

  const plo = createHand({ ...cfg, variant: "plo", deck: standardDeck() });
  assert.equal(plo.players[0].holeCards.length, 4, "PLO deals four hole cards");
  const ploRaise = legalActions(plo).actions.find((a) => a.type === "raise");
  // Heads-up SB to act: committed 1, currentBet 2, pot 3, toCall 1 → max = 2+3+1 = 6.
  assert.equal(ploRaise.min, 4);
  assert.equal(ploRaise.max, 6, "pot-limit raise capped at a pot-sized raise");

  const nl = createHand({ ...cfg, variant: "holdem", deck: standardDeck() });
  const nlRaise = legalActions(nl).actions.find((a) => a.type === "raise");
  assert.equal(nlRaise.max, 1000, "no-limit raise capped only by the stack");
});

// ---------------------------------------------------------------- decks

test("each variant validates its own deck", () => {
  const players = [{ id: 0, seat: 0, stack: 100 }, { id: 1, seat: 1, stack: 100 }];
  const cfg = { players, buttonSeat: 0, smallBlind: 1, bigBlind: 2 };
  const sd = createHand({ ...cfg, variant: "shortdeck", deck: shortDeck() });
  assert.equal(sd.players[0].holeCards.length, 2);
  assert.throws(() => createHand({ ...cfg, variant: "shortdeck", deck: standardDeck() }), /full 36-card/);
  assert.throws(() => createHand({ ...cfg, variant: "plo", deck: shortDeck() }), /full 52-card/);
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

test("every variant plays a full hand to completion, chips conserved", () => {
  for (const seed of [1, 2, 3]) {
    playToEnd("holdem", standardDeck, seed);
    playToEnd("holdem-pl", standardDeck, seed);
    playToEnd("plo", standardDeck, seed);
    playToEnd("plo5", standardDeck, seed);
    playToEnd("shortdeck", shortDeck, seed);
    playToEnd("shortdeck-pl", shortDeck, seed);
  }
});
