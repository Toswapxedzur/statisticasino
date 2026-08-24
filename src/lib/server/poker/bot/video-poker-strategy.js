// Video Poker bot. One decision: which of the five cards to hold before the draw.
// Heuristic close to basic strategy: keep any made flush/straight, keep pairs and
// better, keep four-to-a-flush; otherwise keep high cards (J+) and redraw the rest.
// (Bot skill only affects its own results.)

import { RANKS } from "../engine/cards.js";

const rv = (c) => RANKS.indexOf(c[0]) + 2;

export const VP_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic" },
  aggressive: { key: "aggressive", name: "Aggressive", style: "loose" },
  tight: { key: "tight", name: "Tight", style: "tight" }
};

function holdsFor(cards, style) {
  const vals = cards.map(rv);
  const suits = cards.map((c) => c[1]);
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  const flush = suits.every((s) => s === suits[0]);
  const straight = (uniq.length === 5 && uniq[4] - uniq[0] === 4) || JSON.stringify(uniq) === JSON.stringify([2, 3, 4, 5, 14]);
  if (flush || straight) return [true, true, true, true, true];

  const byRank = new Map();
  cards.forEach((c, i) => { const v = rv(c); if (!byRank.has(v)) byRank.set(v, []); byRank.get(v).push(i); });
  const groups = [...byRank.values()].filter((ix) => ix.length >= 2);
  if (groups.length) {
    const holds = [false, false, false, false, false];
    for (const ix of groups) for (const i of ix) holds[i] = true;
    return holds;
  }
  if (style === "tight") return [false, false, false, false, false]; // no made hand → redraw all

  // four to a flush
  const bySuit = new Map();
  cards.forEach((c, i) => { if (!bySuit.has(c[1])) bySuit.set(c[1], []); bySuit.get(c[1]).push(i); });
  for (const ix of bySuit.values()) {
    if (ix.length === 4) { const h = [false, false, false, false, false]; ix.forEach((i) => (h[i] = true)); return h; }
  }
  if (style === "loose") return cards.map((c) => rv(c) >= 10); // keep tens too
  return cards.map((c) => rv(c) >= 11); // basic: keep jacks or better
}

export const videoPokerStrategy = {
  decide({ turn, tier }) {
    const t = tier || VP_TIERS.basic;
    const cards = turn?.cards || [];
    if (cards.length < 5) return { type: "draw", holds: [true, true, true, true, true] };
    return { type: "draw", holds: holdsFor(cards, t.style) };
  }
};
