import test from "node:test";
import assert from "node:assert/strict";

import { RANKS, SUITS, shuffle, standardDeck } from "./cards.js";

test("standardDeck uses the documented canonical order", () => {
  const deck = standardDeck();
  assert.equal(RANKS, "23456789TJQKA");
  assert.equal(SUITS, "cdhs");
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  assert.deepEqual(deck.slice(0, 4), ["2c", "3c", "4c", "5c"]);
  assert.deepEqual(deck.slice(-4), ["Js", "Qs", "Ks", "As"]);
});

test("shuffle is injectable and never mutates its argument", () => {
  const deck = ["a", "b", "c", "d"];
  const original = [...deck];
  const shuffled = shuffle(deck, () => 0);

  assert.deepEqual(deck, original);
  assert.notStrictEqual(shuffled, deck);
  assert.deepEqual(shuffled, ["b", "c", "d", "a"]);
  assert.throws(() => shuffle(deck, () => 1), /\[0, 1\)/);
});
