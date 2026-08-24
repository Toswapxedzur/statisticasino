// Let It Ride bot — a simplified basic strategy. First decision (3 cards): let it
// ride with a made paying hand or three to a straight flush. Second decision
// (4 cards): ride with a paying hand, four to a flush, or four to an outside
// straight. Otherwise pull the bet back. (Bot skill only affects its own results.)

import { RANKS } from "../engine/cards.js";

const rv = (c) => RANKS.indexOf(c[0]) + 2;
function counts(cards) {
  const m = new Map();
  for (const c of cards) m.set(rv(c), (m.get(rv(c)) || 0) + 1);
  return m;
}
const pairTensPlus = (cards) => [...counts(cards)].some(([v, n]) => n >= 2 && v >= 10);
const hasTrips = (cards) => [...counts(cards).values()].some((n) => n >= 3);
function twoPairPlus(cards) {
  const vals = [...counts(cards).values()];
  return vals.filter((n) => n >= 2).length >= 2 || vals.some((n) => n >= 3);
}
const sameSuit = (cards) => cards.every((c) => c[1] === cards[0][1]);
function distinctSpan(cards, span) {
  const vs = [...new Set(cards.map(rv))];
  return vs.length === cards.length && Math.max(...vs) - Math.min(...vs) <= span;
}

export const LR_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  aggressive: { key: "aggressive", name: "Aggressive", style: "loose", betUnits: 1 },
  tight: { key: "tight", name: "Tight", style: "tight", betUnits: 1 }
};

function ride1(cards, style) {
  if (pairTensPlus(cards) || hasTrips(cards)) return true;
  if (style === "tight") return false;
  if (sameSuit(cards) && distinctSpan(cards, 4)) return true; // 3 to a straight flush
  if (style === "loose") return sameSuit(cards) || distinctSpan(cards, 4);
  return false;
}
function ride2(cards, style) {
  if (pairTensPlus(cards) || twoPairPlus(cards)) return true;
  if (style === "tight") return false;
  if (sameSuit(cards)) return true;        // 4 to a flush
  if (distinctSpan(cards, 3)) return true; // 4 to an outside straight
  return style === "loose";
}

export const letItRideStrategy = {
  decide({ view, turn, seat, tier }) {
    const t = tier || LR_TIERS.basic;
    const actions = turn.actions || [];
    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "pull" };
      return { type: "ante", amount: Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1))) };
    }
    const round = view?.round || {};
    const own = (round.hands || []).find((h) => h.seat === seat)?.cards || [];
    const known = [...own, ...(round.community || [])];
    const ride = turn.phase === "decide1" ? ride1(known, t.style) : ride2(known, t.style);
    return ride ? { type: "ride" } : { type: "pull" };
  }
};
