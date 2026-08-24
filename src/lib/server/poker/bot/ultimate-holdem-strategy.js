// Ultimate Texas Hold'em bot — a simplified take on basic strategy (bot skill only
// affects how fast it feeds the house, so exact optimality isn't needed). Raise 4×
// preflop with strong holdings; on the flop bet 2× with a made pair+; at the river
// bet 1× unless the hand is hopeless. Reads its hole cards from the public view.

import { bestHand } from "../games/toolkit.js";
import { RANKS } from "../engine/cards.js";

const rv = (c) => RANKS.indexOf(c[0]) + 2;

export const UTH_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  aggressive: { key: "aggressive", name: "Aggressive", style: "loose", betUnits: 1 },
  tight: { key: "tight", name: "Tight", style: "tight", betUnits: 1 }
};

function raisePreflop(hole, style) {
  const a = rv(hole[0]);
  const b = rv(hole[1]);
  const pair = a === b;
  const hasAce = a === 14 || b === 14;
  if (style === "loose") return true;
  if (style === "tight") return pair || hasAce;
  const bothHigh = Math.min(a, b) >= 12;
  const suitedHigh = hole[0][1] === hole[1][1] && Math.min(a, b) >= 11;
  return pair || hasAce || bothHigh || suitedHigh;
}

export const ultimateHoldemStrategy = {
  decide({ view, turn, seat, tier }) {
    const t = tier || UTH_TIERS.basic;
    const actions = turn.actions || [];
    const has = (type) => actions.some((a) => a.type === type);

    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "check" };
      return { type: "ante", amount: Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1))) };
    }

    const round = view?.round || {};
    const hole = (round.hands || []).find((h) => h.seat === seat)?.cards || [];
    const board = round.community || [];
    if (hole.length < 2) return has("check") ? { type: "check" } : has("fold") ? { type: "fold" } : { type: "play1x" };

    if (turn.phase === "preflop") {
      return raisePreflop(hole, t.style) && has("play4x") ? { type: "play4x" } : { type: "check" };
    }
    if (turn.phase === "flop") {
      const made = bestHand([...hole, ...board]);
      return made.category >= 1 && has("play2x") ? { type: "play2x" } : { type: "check" };
    }
    // river: bet 1× with any pair+ or an ace, else fold
    const made = bestHand([...hole, ...board]);
    const hasAce = hole.some((c) => rv(c) === 14);
    return (made.category >= 1 || hasAce) && has("play1x") ? { type: "play1x" } : { type: "fold" };
  }
};
