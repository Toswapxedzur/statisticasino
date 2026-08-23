// Monte-Carlo equity estimator for the poker bots.
//
// Estimates a hand's share of the pot by simulating the UNKNOWN cards
// (opponents' hole cards + the rest of the board) many times and scoring each
// runout with the real engine evaluator — so "who wins" is defined in exactly
// one place (engine/), and the sim can't drift from the live game's rules.
//
// It reads ONLY the bot's own hole cards + the public board. It is never given
// an opponent's actual cards, so it structurally cannot cheat: opponents' holes
// are always sampled at random from the remaining deck.

import { standardDeck } from "../engine/cards.js";
import { evaluate7, compareRank } from "../engine/evaluator.js";

// equity(hole, board, numOpponents, iters, rng) -> expected share of the pot in
// [0,1]. Ties split fractionally (a 2-way chop counts 0.5). `rng()` returns a
// float in [0,1); inject a seeded rng for deterministic tests.
export function equity(hole, board, numOpponents, iters, rng = Math.random) {
  if (numOpponents <= 0) return 1;
  const known = new Set([...hole, ...board]);
  const pool = standardDeck().filter((c) => !known.has(c));
  const boardNeed = 5 - board.length;
  const need = numOpponents * 2 + boardNeed;
  if (need > pool.length) throw new RangeError("not enough cards for equity sim");

  let share = 0;
  for (let i = 0; i < iters; i += 1) {
    // Partial Fisher-Yates: draw `need` distinct cards without shuffling the
    // whole pool (cheaper across many iterations).
    const p = [...pool];
    for (let k = 0; k < need; k += 1) {
      const j = k + Math.floor(rng() * (p.length - k));
      const tmp = p[k]; p[k] = p[j]; p[j] = tmp;
    }
    const runout = p.slice(numOpponents * 2, need);
    const fullBoard = board.length === 5 ? board : [...board, ...runout];
    const myRank = evaluate7([...hole, ...fullBoard]);

    let ties = 0;
    let beaten = false;
    for (let o = 0; o < numOpponents; o += 1) {
      const oppRank = evaluate7([p[o * 2], p[o * 2 + 1], ...fullBoard]);
      const cmp = compareRank(myRank, oppRank);
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) ties += 1;
    }
    // Not beaten ⇒ I share the pot with the `ties` opponents that matched me.
    if (!beaten) share += 1 / (ties + 1);
  }
  return share / iters;
}
