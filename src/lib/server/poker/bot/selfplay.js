// Bot-vs-bot self-play harness — how we VALIDATE that a bot change is actually an
// improvement (per the bot plan). Plays many full flop-poker hands between a set
// of tiers with a seeded RNG and returns net chips per seat. Stacks reset each
// hand, so the result is per-hand chip EV; rotating the button keeps positions
// fair. Works for any flop variant (Hold'em / Omaha / Short Deck / Omaha Hi-Lo).

import { createHand, legalActions, applyAction } from "../engine/holdem.js";
import { shuffle } from "../engine/cards.js";
import { getVariant } from "../engine/variants.js";
import { actFor } from "./decide.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// playMatch({ tiers, hands, seed, variant, ... }) -> net chips per seat (index = seat-1).
export function playMatch({ tiers, hands, seed = 1, variant = "holdem", startStack = 1000, sb = 5, bb = 10 }) {
  void legalActions; // actFor uses it internally; kept in imports for clarity
  const rng = mulberry32(seed);
  const n = tiers.length;
  const net = new Array(n).fill(0);
  const deckFactory = getVariant(variant).deck;

  for (let h = 0; h < hands; h += 1) {
    const players = tiers.map((_, i) => ({ id: i + 1, seat: i + 1, stack: startStack }));
    const deck = shuffle(deckFactory(), rng);
    let state;
    try { state = createHand({ players, buttonSeat: (h % n) + 1, smallBlind: sb, bigBlind: bb, deck, variant }); }
    catch { continue; }
    let guard = 0;
    while (state.street !== "complete" && state.toActSeat != null) {
      if (guard++ > 400) break;
      const seat = state.toActSeat;
      let action;
      try { action = actFor(state, seat, tiers[seat - 1], rng); state = applyAction(state, action).state; }
      catch { break; }
    }
    for (const pl of state.players) net[pl.seat - 1] += pl.stack - startStack;
  }
  return net;
}
