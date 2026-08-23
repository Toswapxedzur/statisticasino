// Bot difficulty tiers. Each tier is the SAME decision engine (decide.js) with
// different dials — see DESIGN. Phase 1 ships two opponent-blind tiers; Phase 3
// adds "shark" with opponent modelling + balanced frequencies.
//
// Dials:
//   iters            Monte-Carlo samples per decision (higher = sharper equity).
//   callSlack        extra equity tolerance for calling. >0 ⇒ calls BELOW the
//                    pot-odds price (a calling station); 0 ⇒ correct pot odds.
//   valueRaiseMargin how far equity must beat the call price to raise for value.
//   valueBetThreshold equity needed to bet when checked to.
//   bluffFreq        chance of a semi-bluff when it wouldn't otherwise bet/raise.
//   betSizeFrac      bet/raise size as a fraction of the pot.
//   noise            random jitter added to the equity thresholds (unpredictable).

export const TIERS = {
  // Loose-passive "fish": over-calls (station), rarely raises, barely bluffs,
  // small fixed sizing, coarse/noisy reads. Beatable — the easy tier.
  fish: {
    key: "fish",
    name: "Fish",
    iters: 60,
    callSlack: 0.15,
    valueRaiseMargin: 0.30,
    valueBetThreshold: 0.62,
    bluffFreq: 0.02,
    betSizeFrac: 0.4,
    noise: 0.06
  },
  // Tight-aggressive "reg": correct pot odds, confident value betting, selective
  // value raising, semi-bluffs draws, pot-proportional sizing, low noise. Solid —
  // tough for a casual player. Beats "fish" by ~4.5 bb/hand in duplicate sim.
  //
  // valueRaiseMargin is deliberately HIGH (0.42): equity is estimated vs a
  // uniform-random range, which overvalues raising (a caller's range beats
  // random), so an opponent-blind bot must raise for value only with a real
  // edge — raising loosely on equity-vs-random spews. Aggression comes from
  // value BETTING, not from raising into stronger ranges. (Phase 3's opponent
  // model will let a sharper tier raise wider by reading the actual range.)
  reg: {
    key: "reg",
    name: "Reg",
    iters: 160,
    callSlack: 0.0,
    valueRaiseMargin: 0.42,
    valueBetThreshold: 0.58,
    bluffFreq: 0.08,
    betSizeFrac: 0.65,
    noise: 0.02
  }
};

export const TIER_KEYS = Object.keys(TIERS);
