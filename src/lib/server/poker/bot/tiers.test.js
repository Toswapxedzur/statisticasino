// The tiers must actually be tiered: the tight-aggressive "reg" should beat the
// loose-passive "fish". Measuring that from raw heads-up hands is hopelessly
// noisy (100bb stack-offs give a per-hand SD of several bb), so we use DUPLICATE
// POKER: play every shuffled deck twice with the seats swapped and the same
// decision-rng seed, then sum. Card luck and Monte-Carlo luck both cancel,
// leaving only the strategy difference. As a bonus invariant, two identical
// strategies must then cancel to EXACTLY zero — a sharp correctness check on the
// harness. This test also doubles as the bots' integration test against the real
// engine, and asserts chips are conserved on every hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHand, applyAction } from "../engine/holdem.js";
import { standardDeck, shuffle } from "../engine/cards.js";
import { actFor } from "./decide.js";
import { TIERS } from "./tiers.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Play one fixed deck to completion; returns seat 0's chip delta. Asserts chips
// are conserved (a table never mints or burns chips).
function playDeck(deck, button, start, tierBySeat, decRng) {
  let hand = createHand({
    players: [{ id: "s0", seat: 0, stack: start }, { id: "s1", seat: 1, stack: start }],
    buttonSeat: button, smallBlind: 1, bigBlind: 2, deck
  });
  let guard = 0;
  while (hand.toActSeat !== null) {
    assert.ok(guard++ < 5000, "hand failed to terminate");
    const seat = hand.toActSeat;
    hand = applyAction(hand, actFor(hand, seat, tierBySeat[seat], decRng)).state;
  }
  const s0 = hand.players.find((p) => p.seat === 0).stack;
  const s1 = hand.players.find((p) => p.seat === 1).stack;
  assert.equal(s0 + s1, 2 * start, `chips not conserved: ${s0} + ${s1} ≠ ${2 * start}`);
  return s0 - start;
}

// A's net over B in bb/hand, via duplicate poker. Same deck, same button, same
// per-deck decision seed in both orientations ⇒ only the strategy differs.
function duel(A, B, decks) {
  const deckRng = mulberry32(0xDEC5);
  let aNet = 0;
  for (let d = 0; d < decks; d += 1) {
    const deck = shuffle(standardDeck(), deckRng);
    const button = d % 2;
    const decSeed = (0xB07 + Math.imul(d, 2654435761)) >>> 0;
    aNet += playDeck([...deck], button, 200, { 0: A, 1: B }, mulberry32(decSeed));
    aNet -= playDeck([...deck], button, 200, { 0: B, 1: A }, mulberry32(decSeed));
  }
  return aNet / decks / 2 / 2; // 2 games/deck, /2 chips per bb
}

// Trim iters for test speed — duplicate poker cancels the extra Monte-Carlo
// variance, and it's the relative skill that matters here, not equity precision.
const REG = { ...TIERS.reg, iters: 45 };
const FISH = { ...TIERS.fish, iters: 45 };

test("duplicate harness cancels identical strategies to exactly zero", () => {
  assert.equal(duel(REG, REG, 40), 0, "reg vs reg must net exactly 0");
  assert.equal(duel(FISH, FISH, 40), 0, "fish vs fish must net exactly 0");
});

test("reg (TAG) clearly beats fish (station), and chips are conserved", () => {
  const edge = duel(REG, FISH, 110);
  console.log(`  reg edge over fish = ${edge.toFixed(2)} bb/hand (duplicate)`);
  assert.ok(edge > 1.0, `reg should clearly beat fish; edge was ${edge.toFixed(2)} bb/hand`);
});
