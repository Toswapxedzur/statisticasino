// Monte-Carlo equity estimator for the poker bots — VARIANT-AWARE.
//
// Estimates a hand's share of the pot by simulating the UNKNOWN cards
// (opponents' hole cards + the rest of the board) many times and scoring each
// runout with the variant's own evaluator. Everything that differs between
// poker games — the deck, hole-card count, board size, and how a showdown is
// scored — comes from the variant descriptor, so this ONE sim serves Hold'em,
// Omaha, Short Deck, Omaha Hi-Lo, …
//
// It reads ONLY the bot's own hole cards + the public board; opponents' holes are
// sampled (from a RANGE when `rangeTightness` > 0), so it can't cheat.

import { getVariant } from "../engine/variants.js";
import { RANKS } from "../engine/cards.js";

const rankVal = (c) => RANKS.indexOf(c[0]) + 2;

// A cheap 0..1 "would an opponent play this hand?" score, used to sample from a
// range rather than uniformly. Postflop: their made-hand category on the board.
// Preflop: high card + a pair/suited/connected bonus (works for any hole count).
function holeStrength(oppHole, board, variant) {
  if (board.length >= 3) return variant.evaluate(oppHole, board).category / 8;
  const vals = oppHole.map(rankVal).sort((a, b) => b - a);
  const ranks = new Set(oppHole.map((c) => c[0]));
  const paired = ranks.size < oppHole.length;
  const suited = new Set(oppHole.map((c) => c[1])).size < oppHole.length;
  return Math.min(1, (vals[0] - 2) / 12 * 0.6 + (paired ? 0.3 : 0) + (suited ? 0.1 : 0));
}

export function equity(hole, board, numOpponents, iters, rng = Math.random, variant = getVariant("holdem"), rangeTightness = 0) {
  if (numOpponents <= 0) return 1;
  const holeCount = variant.holeCount;
  const boardSize = variant.boardSchedule.reduce((sum, entry) => sum + entry.deal, 0);
  const hasLow = typeof variant.evaluateLow === "function";
  const known = new Set([...hole, ...board]);
  const pool = variant.deck().filter((card) => !known.has(card));
  const need = numOpponents * holeCount + (boardSize - board.length);
  if (need > pool.length) throw new RangeError("not enough cards for equity sim");
  const floor = rangeTightness > 0 ? rangeTightness * 0.6 : 0; // range strength cut-off

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

    // Opponent holes — optionally rejection-sampled toward an in-range strength.
    const oppHoles = [];
    for (let o = 0; o < numOpponents; o += 1) {
      let h = p.slice(o * holeCount, o * holeCount + holeCount);
      if (floor > 0) {
        for (let attempt = 0; attempt < 6 && holeStrength(h, board, variant) < floor; attempt += 1) {
          // reshuffle this opponent's slice from the tail of the pool
          for (let k = o * holeCount; k < o * holeCount + holeCount; k += 1) {
            const j = need + Math.floor(rng() * (p.length - need));
            const tmp = p[k]; p[k] = p[j]; p[j] = tmp;
          }
          h = p.slice(o * holeCount, o * holeCount + holeCount);
        }
      }
      oppHoles.push(h);
    }

    const myHigh = variant.evaluate(hole, fullBoard);
    const myLow = hasLow ? variant.evaluateLow(hole, fullBoard) : null;

    let highTies = 0;
    let highBeaten = false;
    const oppLows = [];
    for (const oppHole of oppHoles) {
      const cmp = variant.compare(myHigh, variant.evaluate(oppHole, fullBoard));
      if (cmp < 0) { highBeaten = true; }
      else if (cmp === 0) highTies += 1;
      if (hasLow) { const ol = variant.evaluateLow(oppHole, fullBoard); if (ol) oppLows.push(ol); }
    }
    const highShare = highBeaten ? 0 : 1 / (highTies + 1);

    if (!hasLow) { share += highShare; continue; }

    const anyLow = myLow || oppLows.length;
    if (!anyLow) { share += highShare; continue; } // no qualifying low → high scoops
    let lowShare = 0;
    if (myLow) {
      let lowTies = 0;
      let lowBeaten = false;
      for (const ol of oppLows) { const c = variant.compareLow(myLow, ol); if (c > 0) { lowBeaten = true; break; } else if (c === 0) lowTies += 1; }
      lowShare = lowBeaten ? 0 : 1 / (lowTies + 1);
    }
    share += 0.5 * highShare + 0.5 * lowShare;
  }
  return share / iters;
}
