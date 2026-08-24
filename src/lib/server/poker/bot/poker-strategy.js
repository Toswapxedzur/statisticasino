// The poker "brain" as a Strategy: turn the redacted client frames into a poker
// observation and run the pot-odds / Monte-Carlo-equity decision engine. Pulled
// out of BotConn so the bot transport is game-agnostic (see blackjack-strategy.js).

import { decide } from "./decide.js";
import { getVariant } from "../engine/variants.js";
import { RANKS } from "../engine/cards.js";
import { equity, studEquity } from "./equity.js";
import { exploitDials } from "./opponent-model.js";

// Shared equity-vs-pot-odds policy for the non-flop bots (draw + stud), dialled by
// the (optionally exploit-adjusted) tier. Mirrors decide()'s core branch — raise
// for value on a real edge, call when priced in (callSlack lets a station call
// lighter), bet when checked to above the value threshold — but without a board so
// no semi-bluff/sizing math. Bets/raises use the min legal size (kept simple).
function actFromEquity(E, turn, tier, read) {
  const t = exploitDials(tier, read);
  const actions = turn.actions || [];
  const has = (ty) => actions.some((a) => a.type === ty);
  const min = (ty) => actions.find((a) => a.type === ty)?.min;
  const toCall = turn.callAmount || 0;
  const pot = turn.potTotal || 0;
  if (toCall > 0) {
    const R = toCall / (pot + toCall); // equity needed to call
    if (E >= R + t.valueRaiseMargin && has("raise")) return { type: "raise", amount: min("raise") };
    if (E >= R - t.callSlack) return has("call") ? { type: "call" } : { type: "check" };
    return has("check") ? { type: "check" } : { type: "fold" };
  }
  if (E >= t.valueBetThreshold && has("bet")) return { type: "bet", amount: min("bet") };
  return has("check") ? { type: "check" } : { type: "fold" };
}

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

// Five-Card Draw betting: equity of the current 5-card hand vs opponents' random
// 5-card hands (no board), priced against the pot — the same equity/pot-odds logic
// the flop bot uses, via the five-card-draw descriptor's evaluator.
const DRAW_VARIANT = getVariant("five-card-draw");
function drawBet(hole, turn, numOpp, rng, tier, read) {
  const E = equity(hole, [], Math.max(1, numOpp), 120, rng, DRAW_VARIANT);
  return actFromEquity(E, turn, tier, read);
}

// Seven-Card Stud: real equity, up-card-aware. The bot knows its own cards and
// every live opponent's UP cards (public) — studEquity removes those as dead cards
// and simulates each hand to 7 — then bets on equity vs pot odds, exploit-dialled
// by the opponent read. A big improvement on the old made/strong strength heuristic.
function studBet(hole, turn, view, seat, rng, tier, read) {
  const oppUp = (view?.seats || [])
    .filter((s) => s.seat !== seat && s.inHand && s.status !== "folded")
    .map((s) => s.upCards || []);
  if (oppUp.length === 0) {
    const has = (t) => (turn.actions || []).some((a) => a.type === t);
    return has("check") ? { type: "check" } : has("call") ? { type: "call" } : { type: "fold" };
  }
  const E = studEquity(hole, oppUp, 150, rng) ?? 0.5;
  return actFromEquity(E, turn, tier, read);
}

export const pokerStrategy = {
  // ctx: { view, turn, hole, seat, tier, rng, variantKey, read }
  decide({ view, turn, hole, seat, tier, rng, variantKey, read = null }) {
    if (!hole || hole.length < 2) return safe(turn);
    // Five-Card Draw's draw phase: choose discards rather than a bet.
    if ((turn.actions || []).some((a) => a.type === "draw")) return { type: "draw", discards: drawDiscards(hole) };
    const v = view || {};
    const numOpponents = (v.seats || []).filter((s) => s.seat !== seat && s.inHand && s.status !== "folded").length;
    // Five-Card Draw betting: equity-based (its own evaluator, no board), read-aware.
    if (variantKey === "five-card-draw") return drawBet(hole, turn, numOpponents, rng, tier, read);
    // Seven-Card Stud: up-card-aware equity vs pot odds, read-aware.
    if (variantKey === "seven-card-stud") return studBet(hole, turn, v, seat, rng, tier, read);
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
    return decide(obs, tier, rng, read);
  }
};
