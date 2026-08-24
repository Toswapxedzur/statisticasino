// The poker "brain" as a Strategy: turn the redacted client frames into a poker
// observation and run the pot-odds / Monte-Carlo-equity decision engine. Pulled
// out of BotConn so the bot transport is game-agnostic (see blackjack-strategy.js).

import { decide } from "./decide.js";
import { getVariant } from "../engine/variants.js";
import { RANKS } from "../engine/cards.js";
import { bestHand, STANDARD_MODEL } from "../engine/evaluator.js";

function safe(turn) {
  return (turn.actions || []).some((a) => a.type === "check") ? { type: "check" } : { type: "fold" };
}

// Five-Card Draw discard heuristic: keep made flushes/straights (stand pat), pairs
// or better, four-to-a-flush, else the high cards; discard the rest.
const rv = (c) => RANKS.indexOf(c[0]) + 2;
function drawDiscards(hole) {
  const n = hole.length;
  const all = [...Array(n).keys()];
  const vals = hole.map(rv);
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  const flush = hole.every((c) => c[1] === hole[0][1]);
  const straight = (uniq.length === 5 && uniq[4] - uniq[0] === 4) || JSON.stringify(uniq) === JSON.stringify([2, 3, 4, 5, 14]);
  if (flush || straight) return [];

  const byRank = new Map();
  hole.forEach((c, i) => { const v = rv(c); if (!byRank.has(v)) byRank.set(v, []); byRank.get(v).push(i); });
  const groups = [...byRank.values()].filter((ix) => ix.length >= 2);
  if (groups.length) { const keep = new Set(groups.flat()); return all.filter((i) => !keep.has(i)); }

  const bySuit = new Map();
  hole.forEach((c, i) => { if (!bySuit.has(c[1])) bySuit.set(c[1], []); bySuit.get(c[1]).push(i); });
  for (const ix of bySuit.values()) if (ix.length === 4) return all.filter((i) => !ix.includes(i));

  const highs = all.filter((i) => rv(hole[i]) >= 11);
  if (highs.length) return all.filter((i) => !highs.includes(i));
  const hiIdx = vals.indexOf(Math.max(...vals));
  return all.filter((i) => i !== hiIdx); // keep only the top card
}

// Simple strength-based betting for Five-Card Draw (the Monte-Carlo equity engine
// assumes community cards, so it isn't used here). Value-bets a pair or better.
function drawBet(hole, turn) {
  const actions = turn.actions || [];
  const has = (t) => actions.some((a) => a.type === t);
  const rank = bestHand(hole, STANDARD_MODEL);
  const made = rank.category >= 1;   // a pair or better
  const strong = rank.category >= 3; // trips or better
  if ((turn.callAmount || 0) > 0) {
    if (strong && has("raise")) return { type: "raise", amount: actions.find((a) => a.type === "raise").min };
    if (made && has("call")) return { type: "call" };
    return has("check") ? { type: "check" } : { type: "fold" };
  }
  if (made && has("bet")) return { type: "bet", amount: actions.find((a) => a.type === "bet").min };
  return has("check") ? { type: "check" } : { type: "fold" };
}

export const pokerStrategy = {
  // ctx: { view, turn, hole, seat, tier, rng, variantKey }
  decide({ view, turn, hole, seat, tier, rng, variantKey }) {
    if (!hole || hole.length < 2) return safe(turn);
    // Five-Card Draw's draw phase: choose discards rather than a bet.
    if ((turn.actions || []).some((a) => a.type === "draw")) return { type: "draw", discards: drawDiscards(hole) };
    // Five-Card Draw betting uses a simple strength heuristic (no community cards
    // for the equity engine to model).
    if (variantKey === "five-card-draw") return drawBet(hole, turn);
    const v = view || {};
    const seats = v.seats || [];
    const numOpponents = seats.filter(
      (s) => s.seat !== seat && s.inHand && s.status !== "folded"
    ).length;
    if (numOpponents < 1) return safe(turn);
    const obs = {
      hole: [...hole],
      board: [...(v.board || [])],
      street: v.street || null,
      toCall: turn.callAmount || 0,
      pot: turn.potTotal || 0,
      currentBet: turn.currentBet || 0,
      minRaise: turn.minRaise || 0,
      numOpponents,
      actions: turn.actions || [],
      variant: getVariant(variantKey)
    };
    return decide(obs, tier, rng);
  }
};
