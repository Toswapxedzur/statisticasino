// Adaptive opponent model — Tier 2. Accumulates per-opponent tendencies across
// hands and turns them into a "read" the decision engine EXPLOITS. Stats are
// Beta-Binomial shrunk toward neutral priors, so a few hands read near-neutral
// (the bot plays its baseline) and the read only sharpens with evidence — the
// same "coefficient, not a switch" idea as Big Two: a confidence coefficient
// κ ∈ [0,1] scales how far the bot leans into the exploit.
//
//   foldToBet — how often they fold facing a bet   → high: bluff them; low: never
//   af        — aggression factor (bets+raises)/calls → high: their bets mean less
//   vpip      — how loose they enter pots           → high: wider, thinner value

const PRIOR = { foldToBet: 0.45, af: 1.0, vpip: 0.35 };
const SHRINK = 8;   // pseudo-count pulling estimates toward the priors
const CONF_N = 20;  // observations at which κ reaches 0.5

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function createOpponentModel() {
  const stats = new Map(); // oppId -> counters

  return {
    // Record one observed action by `oppId`.
    //   { action: "fold"|"call"|"check"|"bet"|"raise"|"allin",
    //     facingBet: bool,           // there was a live bet to call
    //     vpipChance: bool, voluntary: bool }  // preflop, could put money in
    observe(oppId, ev) {
      const s = stats.get(oppId) || { total: 0, faced: 0, folds: 0, aggr: 0, calls: 0, vpChances: 0, vpActs: 0 };
      s.total += 1; // every observed action is evidence (drives confidence κ)
      if (ev.facingBet) { s.faced += 1; if (ev.action === "fold") s.folds += 1; }
      if (ev.action === "bet" || ev.action === "raise" || ev.action === "allin") s.aggr += 1;
      else if (ev.action === "call") s.calls += 1;
      if (ev.vpipChance) { s.vpChances += 1; if (ev.voluntary) s.vpActs += 1; }
      stats.set(oppId, s);
    },

    read(oppId) {
      const s = stats.get(oppId);
      if (!s) return { n: 0, foldToBet: PRIOR.foldToBet, af: PRIOR.af, vpip: PRIOR.vpip, kappa: 0 };
      const foldToBet = (s.folds + PRIOR.foldToBet * SHRINK) / (s.faced + SHRINK);
      const af = (s.aggr + PRIOR.af * SHRINK) / (s.calls + SHRINK);
      const vpip = (s.vpActs + PRIOR.vpip * SHRINK) / (s.vpChances + SHRINK);
      const n = s.total; // total observed actions → confidence sample size
      return { n, foldToBet, af, vpip, kappa: n / (n + CONF_N) };
    },

    reset() { stats.clear(); }
  };
}

// Combine several per-opponent reads into one table read (for a multiway pot).
// Fields are averaged weighted by evidence (n+1), and confidence κ is recomputed
// from the total observation count. Heads-up (one read) passes through unchanged;
// an empty list → null (no read, play baseline).
export function combineReads(reads) {
  const valid = (reads || []).filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  let wSum = 0, fold = 0, af = 0, vpip = 0, nTot = 0;
  for (const r of valid) {
    const w = r.n + 1;
    wSum += w; fold += r.foldToBet * w; af += r.af * w; vpip += r.vpip * w; nTot += r.n;
  }
  return { n: nTot, foldToBet: fold / wSum, af: af / wSum, vpip: vpip / wSum, kappa: nTot / (nTot + CONF_N) };
}

// Blend a tier's baseline dials with the exploit implied by `read`, scaled by the
// tier's exploitGain × the read's confidence κ. A neutral/empty read (κ≈0) or a
// non-adaptive tier (no exploitGain) returns the baseline unchanged.
//
// We adjust ONLY the "safe" levers — bluff frequency, call-down slack, and a small
// thin-value nudge. We deliberately do NOT loosen valueRaiseMargin: equity is
// estimated vs a range and OVERVALUES raising (a caller's range beats it), so
// raising thinner spews even against a station — a hard-won tuning lesson (see
// tiers.js). Aggression against a loose payer comes from value BETTING, not raising.
// Exploit strength per lever (overridable on a tier for tuning/sweeps).
const K_BLUFF = 0.7;   // bluff response to fold-to-bet
const K_VALUE = 0.24;  // thin-value response to VPIP (gated on passivity)
const K_CALL = 0.12;   // call-down response to aggression factor

export function exploitDials(tier, read) {
  if (!read || !tier.exploitGain || read.kappa <= 0) return tier;
  const g = tier.exploitGain * read.kappa;
  const kBluff = tier.exploitBluffK ?? K_BLUFF;
  const kValue = tier.exploitValueK ?? K_VALUE;
  const kCall = tier.exploitCallK ?? K_CALL;
  // Thin value pays off only vs loose-PASSIVE opponents: a loose-AGGRESSIVE maniac
  // raises us off thin bets and pays its own value, so gate the lever on passivity.
  const passive = clamp(1.4 - read.af, 0, 1); // ~1 for a passive station, 0 for a maniac
  return {
    ...tier,
    // Foldy opponents (fold-to-bet above prior) → bluff/semi-bluff more; calling
    // stations (below prior) → bluff toward zero (bluffing a station is ~0 EV).
    bluffFreq: clamp(tier.bluffFreq + g * (read.foldToBet - PRIOR.foldToBet) * kBluff, 0, 0.6),
    // Loose-passive opponents pay off thin value BETS — a modest nudge, floored
    // well above coin-flip, and only when they're passive enough to just call.
    valueBetThreshold: clamp(tier.valueBetThreshold - g * Math.max(0, read.vpip - PRIOR.vpip) * passive * kValue, 0.5, 0.9),
    // Maniacs (very high AF) bet/raise light → call down a little lighter so their
    // constant aggression can't bluff us off the best hand. Only true maniacs
    // (AF ≫ prior), capped small so we don't become a station ourselves.
    callSlack: clamp(tier.callSlack + g * Math.max(0, read.af - 1.5) * kCall, 0, 0.12)
  };
}
