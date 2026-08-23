// Casino Hold'em bot brain. Two decisions: post the ante (flat), then Call or
// Fold after the flop. Optimal Casino Hold'em folds only the very worst spots
// (~18%), so a simple rule is close: call with a pair-or-better, a made
// draw-heavy board, or high cards; fold weak unpaired low hands. Reads its hand
// + the flop from the public view (hole cards are shown in this game).

import { bestHand } from "../games/toolkit.js";
import { RANKS } from "../engine/cards.js";

export const CH_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  loose: { key: "loose", name: "Loose", style: "loose", betUnits: 1 },
  tight: { key: "tight", name: "Tight", style: "tight", betUnits: 1 }
};
export const CH_TIER_KEYS = Object.keys(CH_TIERS);

const rankVal = (card) => RANKS.indexOf(card[0]) + 2;

function shouldCall(hole, flop, style) {
  const made = bestHand([...hole, ...flop]); // best 5 of the 5 known cards
  const pairPlus = made.category >= 1;
  if (style === "loose") return true;               // calls everything
  if (style === "tight") return pairPlus;            // only a made hand
  // basic: a made hand, or a high/ace-ish holding worth seeing the river.
  const high = Math.max(rankVal(hole[0]), rankVal(hole[1]));
  return pairPlus || high >= 12; // Q+ or an ace
}

export const casinoHoldemStrategy = {
  decide({ view, turn, seat, tier }) {
    const t = tier || CH_TIERS.basic;
    const actions = turn.actions || [];
    const has = (type) => actions.some((a) => a.type === type);

    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "fold" };
      const amount = Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1)));
      return { type: "ante", amount };
    }

    // decision: call or fold
    const round = view?.round || {};
    const myHand = (round.hands || []).find((h) => h.seat === seat);
    const flop = round.community || [];
    if (!myHand || myHand.cards.length < 2 || flop.length < 3) return has("call") ? { type: "call" } : { type: "fold" };
    return shouldCall(myHand.cards, flop, t.style) && has("call") ? { type: "call" } : { type: "fold" };
  }
};
