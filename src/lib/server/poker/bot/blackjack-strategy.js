// The blackjack "brain" as a Strategy. Blackjack has an exact optimal — basic
// strategy — so there's NO Monte-Carlo, just a lookup by (my total, soft/hard,
// dealer up-card, which actions are legal). Everything it needs is in the public
// view (blackjack hands are face-up), so it never sees a private card it
// shouldn't. Personality tiers express aggressive/passive as DECISION styles
// (you can't influence which card you draw — only whether you take one):
//   basic      — perfect basic strategy (near-optimal; the shark/reg tier)
//   aggressive — hits every stiff + doubles freely + bets bigger → busts a lot
//   timid      — stands the moment it's risky, never doubles → bleeds slowly

import { handValue } from "../games/blackjack.js";

export const BJ_TIERS = {
  basic: { key: "basic", name: "Basic", style: "basic", betUnits: 1 },
  aggressive: { key: "aggressive", name: "Aggressive", style: "aggressive", betUnits: 3 },
  timid: { key: "timid", name: "Timid", style: "timid", betUnits: 1 }
};
export const BJ_TIER_KEYS = Object.keys(BJ_TIERS);

function upValue(card) {
  const r = card[0];
  if (r === "A") return 11;
  if ("TJQK".includes(r)) return 10;
  return Number(r);
}

// Perfect basic strategy: multi-deck, dealer stands soft 17, no split (pairs are
// played as their total). Returns "hit" | "stand" | "double" | "surrender".
function basicPlay(total, soft, up, canDouble, canSurrender) {
  if (canSurrender && !soft) {
    if (total === 16 && (up === 9 || up === 10 || up === 11)) return "surrender";
    if (total === 15 && up === 10) return "surrender";
  }
  if (soft) {
    if (total >= 19) return "stand";                 // A8, A9
    if (total === 18) {                              // A7
      if (up >= 3 && up <= 6) return canDouble ? "double" : "stand";
      if (up === 2 || up === 7 || up === 8) return "stand";
      return "hit";
    }
    if (total === 17) return up >= 3 && up <= 6 && canDouble ? "double" : "hit"; // A6
    if (total >= 15) return up >= 4 && up <= 6 && canDouble ? "double" : "hit";  // A4, A5
    return up >= 5 && up <= 6 && canDouble ? "double" : "hit";                    // A2, A3
  }
  if (total >= 17) return "stand";
  if (total >= 13) return up <= 6 ? "stand" : "hit";           // 13-16
  if (total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (total === 11) return canDouble && up <= 10 ? "double" : "hit";
  if (total === 10) return canDouble && up <= 9 ? "double" : "hit";
  if (total === 9) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
  return "hit";                                                // 4-8
}

// Chases 21: hits every stiff, doubles freely on 9-11.
function aggressivePlay(total, soft, canDouble) {
  if (soft) { if (total >= 19) return "stand"; if (canDouble && total >= 15) return "double"; return "hit"; }
  if (total >= 17) return "stand";
  if (total >= 9 && total <= 11 && canDouble) return "double";
  return "hit";
}

// Never busts a stiff, never doubles/surrenders.
function timidPlay(total, soft) {
  if (soft) return total >= 18 ? "stand" : "hit";
  return total >= 12 ? "stand" : "hit";
}

export const blackjackStrategy = {
  // ctx: { view, turn, seat, tier, rng }
  decide({ view, turn, seat, tier }) {
    const t = tier || BJ_TIERS.basic;
    const actions = turn.actions || [];
    const has = (type) => actions.some((a) => a.type === type);

    if (turn.phase === "betting") {
      const bet = actions.find((a) => a.type === "bet");
      if (!bet) return { type: "stand" };
      const amount = Math.max(bet.min, Math.min(bet.max, bet.min * (t.betUnits || 1)));
      return { type: "bet", amount };
    }

    const round = view?.round || {};
    const myHand = (round.hands || []).find((h) => h.seat === seat);
    const dealerCards = round.dealer?.cards || [];
    if (!myHand || dealerCards.length === 0) return { type: "stand" };

    const { total, soft } = handValue(myHand.cards);
    const up = upValue(dealerCards[0]);
    const canDouble = has("double");
    const canSurrender = has("surrender");

    let want;
    if (t.style === "aggressive") want = aggressivePlay(total, soft, canDouble);
    else if (t.style === "timid") want = timidPlay(total, soft);
    else want = basicPlay(total, soft, up, canDouble, canSurrender);

    // Standard fallbacks when the wanted move isn't on the legal menu.
    if (want === "double" && !canDouble) want = soft && total >= 18 ? "stand" : "hit";
    if (want === "surrender" && !canSurrender) want = "hit";
    if (want === "stand" && !has("stand")) want = "hit";
    if (want === "hit" && !has("hit")) want = "stand";
    return { type: want };
  }
};
