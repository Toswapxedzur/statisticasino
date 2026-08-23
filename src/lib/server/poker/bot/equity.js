// Monte-Carlo equity estimator for the poker bots — VARIANT-AWARE.
//
// Estimates a hand's share of the pot by simulating the UNKNOWN cards
// (opponents' hole cards + the rest of the board) many times and scoring each
// runout with the variant's own evaluator. Everything that differs between
// poker games — the deck, how many hole cards each player holds, how big the
// board is, and how a showdown is scored — comes from the variant descriptor,
// so this ONE sim serves Hold'em, Omaha, Short Deck, … (answering "do we need a
// Monte-Carlo per game?" — no).
//
// It reads ONLY the bot's own hole cards + the public board; opponents' holes are
// always sampled at random, so it structurally cannot cheat.

import { getVariant } from "../engine/variants.js";

// equity(hole, board, numOpponents, iters, rng, variant) -> expected share of
// the pot in [0,1]. Ties split fractionally. `variant` defaults to Hold'em.
export function equity(hole, board, numOpponents, iters, rng = Math.random, variant = getVariant("holdem")) {
  if (numOpponents <= 0) return 1;
  const holeCount = variant.holeCount;
  const boardSize = variant.boardSchedule.reduce((sum, entry) => sum + entry.deal, 0);
  const known = new Set([...hole, ...board]);
  const pool = variant.deck().filter((card) => !known.has(card));
  const need = numOpponents * holeCount + (boardSize - board.length);
  if (need > pool.length) throw new RangeError("not enough cards for equity sim");

  let share = 0;
  for (let i = 0; i < iters; i += 1) {
    // Partial Fisher-Yates: draw `need` distinct cards without a full shuffle.
    const p = [...pool];
    for (let k = 0; k < need; k += 1) {
      const j = k + Math.floor(rng() * (p.length - k));
      const tmp = p[k]; p[k] = p[j]; p[j] = tmp;
    }
    const oppCards = numOpponents * holeCount;
    const runout = p.slice(oppCards, need);
    const fullBoard = board.length === boardSize ? board : [...board, ...runout];
    const myRank = variant.evaluate(hole, fullBoard);

    let ties = 0;
    let beaten = false;
    for (let o = 0; o < numOpponents; o += 1) {
      const oppHole = p.slice(o * holeCount, o * holeCount + holeCount);
      const cmp = variant.compare(myRank, variant.evaluate(oppHole, fullBoard));
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) ties += 1;
    }
    if (!beaten) share += 1 / (ties + 1);
  }
  return share / iters;
}
