// The poker "brain" as a Strategy: turn the redacted client frames into a poker
// observation and run the pot-odds / Monte-Carlo-equity decision engine. Pulled
// out of BotConn so the bot transport is game-agnostic (see blackjack-strategy.js).

import { decide } from "./decide.js";
import { getVariant } from "../engine/variants.js";

function safe(turn) {
  return (turn.actions || []).some((a) => a.type === "check") ? { type: "check" } : { type: "fold" };
}

export const pokerStrategy = {
  // ctx: { view, turn, hole, seat, tier, rng, variantKey }
  decide({ view, turn, hole, seat, tier, rng, variantKey }) {
    if (!hole || hole.length < 2) return safe(turn);
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
