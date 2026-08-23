// Three Card Poker bot. Ante (flat), then the classic optimal rule: PLAY if your
// hand is Queen-6-4 or better, else Fold. Reads its 3 cards from the public view.

import { rank3, threeCard } from "../games/three-card.js";
import { compareRank } from "../games/toolkit.js";

void threeCard;
const Q64 = rank3(["Qs", "6d", "4c"]); // the play/fold threshold

export const TC_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  loose: { key: "loose", name: "Loose", style: "loose", betUnits: 1 },
  tight: { key: "tight", name: "Tight", style: "tight", betUnits: 1 }
};
export const TC_TIER_KEYS = Object.keys(TC_TIERS);

export const threeCardStrategy = {
  decide({ view, turn, seat, tier }) {
    const t = tier || TC_TIERS.basic;
    const actions = turn.actions || [];
    const has = (type) => actions.some((a) => a.type === type);

    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "fold" };
      const amount = Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1)));
      return { type: "ante", amount };
    }

    const myHand = (view?.round?.hands || []).find((h) => h.seat === seat);
    if (!myHand || myHand.cards.length < 3) return has("play") ? { type: "play" } : { type: "fold" };
    const rank = rank3(myHand.cards);
    let play;
    if (t.style === "loose") play = true;
    else if (t.style === "tight") play = rank.category >= 1;   // only a pair or better
    else play = compareRank(rank, Q64) >= 0;                    // Q-6-4 or better
    return play && has("play") ? { type: "play" } : { type: "fold" };
  }
};
