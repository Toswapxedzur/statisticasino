// Caribbean Stud bot. Two decisions: post the ante (flat), then Call or Fold.
// Near-optimal strategy calls with any pair-or-better and folds worse than
// Ace-King-high — so that's the "basic" rule; tiers just widen/narrow it.

import { bestHand } from "../games/toolkit.js";

export const CS_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  aggressive: { key: "aggressive", name: "Aggressive", style: "loose", betUnits: 1 },
  tight: { key: "tight", name: "Tight", style: "tight", betUnits: 1 }
};

function shouldCall(cards, style) {
  const rank = bestHand(cards);
  if (style === "loose") return true;
  if (rank.category >= 1) return true;                       // any pair or better
  if (style === "tight") return false;
  return rank.ranks[0] === 14 && rank.ranks[1] === 13;        // basic: also call Ace-King high
}

export const caribbeanStudStrategy = {
  decide({ view, turn, seat, tier }) {
    const t = tier || CS_TIERS.basic;
    const actions = turn.actions || [];
    const has = (type) => actions.some((a) => a.type === type);
    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "fold" };
      return { type: "ante", amount: Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1))) };
    }
    const myHand = (view?.round?.hands || []).find((h) => h.seat === seat);
    if (!myHand || myHand.cards.length < 5) return has("call") ? { type: "call" } : { type: "fold" };
    return shouldCall(myHand.cards, t.style) && has("call") ? { type: "call" } : { type: "fold" };
  }
};
