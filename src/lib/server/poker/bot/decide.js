// The bot decision engine: Monte-Carlo equity vs. pot odds, dialled by tier.
//
//   observe(state, seat) -> a REDACTED view (this seat's hole cards + public
//                           info only). decide() never sees the full state, so
//                           it structurally can't read opponents' cards.
//   decide(obs, tier, rng) -> a legal action { type, amount? } (no seat).
//   actFor(state, seat, tier, rng) -> the same action, seated, ready for
//                           applyAction() / table.act().
//
// The whole engine is one branch: compare equity `E` to the pot-odds price `R`
// (= toCall / (pot+toCall), the equity you need to break even on a call), then
// raise / call / fold — with tier dials shifting the thresholds, sizing, and
// bluff frequency. See tiers.js.

import { legalActions } from "../engine/holdem.js";
import { getVariant } from "../engine/variants.js";
import { equity } from "./equity.js";
import { exploitDials } from "./opponent-model.js";

// Build the bot's observation from the engine hand-state.
export function observe(state, seat) {
  const me = state.players.find((p) => p.seat === seat);
  if (!me) throw new Error(`seat ${seat} is not in the hand`);
  const menu = legalActions(state);
  const call = menu.actions.find((a) => a.type === "call");
  // Opponents still contesting the pot (not folded) — the field the equity sim
  // runs against. Folded players don't count.
  const numOpponents = state.players.filter(
    (p) => p.seat !== seat && p.status !== "folded"
  ).length;
  const pot = state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  return {
    hole: [...me.holeCards],
    board: [...state.board],
    street: state.street,
    toCall: call ? call.amount : 0,
    pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    myStack: me.stack,
    myCommitted: me.committedThisStreet,
    numOpponents,
    actions: menu.actions,
    variant: getVariant(state.variantKey)
  };
}

const find = (obs, type) => obs.actions.find((a) => a.type === type);

// A bet/raise target TOTAL for the current street, clamped to the legal
// [min, max]. Facing a bet we raise to (currentBet + frac·(pot+toCall)); into a
// checked pot we bet frac·pot. min pulls tiny sizings up to the smallest legal.
function sizedTarget(action, obs, tier) {
  const desired = obs.toCall > 0
    ? Math.round(obs.currentBet + tier.betSizeFrac * (obs.pot + obs.toCall))
    : Math.round(tier.betSizeFrac * obs.pot);
  return Math.max(action.min, Math.min(action.max, desired));
}

// A semi-bluff candidate: cards still to come and middling equity (a draw) —
// not a made hand, not hopeless.
function isDraw(obs, E) {
  return obs.board.length < 5 && E >= 0.30 && E <= 0.55;
}

export function decide(obs, tier, rng = Math.random, read = null) {
  // Fold the opponent read into the tier's dials (bluff/value/slack), scaled by
  // the read's confidence. Neutral read or a non-adaptive tier → baseline.
  const t = exploitDials(tier, read);
  const raise = find(obs, "raise");
  const putChips = find(obs, "bet") || raise; // aggressive option, if any
  const allin = find(obs, "allin");
  const variant = obs.variant || getVariant("holdem");
  // Range-aware tiers (rangeTightness > 0) estimate equity vs a plausible
  // opponent RANGE, tightened further when facing a bet (chips in = stronger
  // range). Opponent-blind tiers (reg/fish) keep equity-vs-random unchanged.
  const base = t.rangeTightness ?? 0;
  // Only assume a tight opponent range when they've put chips in (a bet/raise);
  // unopened, opponents play a wide range, so barely tighten.
  const tightness = base > 0 ? (obs.toCall > 0 ? base : base * 0.25) : 0;
  const E = equity(obs.hole, obs.board, obs.numOpponents, t.iters, rng, variant, tightness);
  const eEff = E + (rng() - 0.5) * t.noise;

  if (obs.toCall > 0) {
    const R = obs.toCall / (obs.pot + obs.toCall); // equity needed to call
    // Strong enough to raise for value.
    if (eEff >= R + t.valueRaiseMargin) {
      if (raise) return { type: "raise", amount: sizedTarget(raise, obs, t) };
      if (allin && eEff >= 0.72) return { type: "allin" }; // short stack: shove value
    }
    // Priced-in call (callSlack lets a "station" tier call below the price).
    if (eEff >= R - t.callSlack) {
      return find(obs, "call") ? { type: "call" } : { type: "check" };
    }
    // Otherwise a fold — unless a semi-bluff raise with fold equity.
    if (raise && isDraw(obs, E) && rng() < t.bluffFreq) {
      return { type: "raise", amount: sizedTarget(raise, obs, t) };
    }
    return { type: "fold" };
  }

  // Checked to us: bet for value, occasionally semi-bluff, else check.
  if (putChips && eEff >= t.valueBetThreshold) {
    return { type: putChips.type, amount: sizedTarget(putChips, obs, t) };
  }
  if (!putChips && allin && eEff >= 0.72) return { type: "allin" }; // short-stack value
  if (putChips && isDraw(obs, E) && rng() < t.bluffFreq) {
    return { type: putChips.type, amount: sizedTarget(putChips, obs, t) };
  }
  if (find(obs, "check")) return { type: "check" };
  // No check available while facing no bet shouldn't happen; stay legal.
  return find(obs, "call") ? { type: "call" } : { type: "fold" };
}

// Choose a legal, seated action for `seat` in `state`. `read` (optional) is the
// adaptive opponent read for the seat's lone opponent (heads-up) or the aggregate.
export function actFor(state, seat, tier, rng = Math.random, read = null) {
  return { ...decide(observe(state, seat), tier, rng, read), seat };
}
