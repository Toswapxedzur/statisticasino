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
  },
  // Range-aware "shark": estimates equity vs a plausible opponent RANGE (tighter
  // when facing a bet) rather than vs random, so it folds marginal hands to
  // aggression and value-raises on a real edge. Dials TUNED by self-play (see
  // selfplay.test.js): it beats reg on every tested seed (~+14 chips/hand) and
  // crushes fish. Key tuning lessons the harness surfaced — bluff SPARINGLY
  // (loose opponents don't fold) and keep a real value-raise margin (0.30);
  // an over-aggressive first cut (margin 0.14, bluff 0.14) actually lost.
  shark: {
    key: "shark",
    name: "Shark",
    iters: 200,
    callSlack: 0.0,
    valueRaiseMargin: 0.30,
    valueBetThreshold: 0.56,
    bluffFreq: 0.05,
    betSizeFrac: 0.66,
    noise: 0.01,
    rangeTightness: 0.38
  },
  // Adaptive "pro": the shark's range-aware baseline PLUS a per-opponent model
  // (opponent-model.js) it exploits. `exploitGain` is how hard it leans into a
  // read once confident (κ→1): it bluffs foldy opponents more, value-bets/raises
  // thinner vs loose ones, and calls down lighter vs maniacs — a continuous
  // exploit coefficient, not a switch. With no read (heads-up first hands, or a
  // neutral opponent) it plays exactly like the shark. The hardest tier.
  pro: {
    key: "pro",
    name: "Pro",
    iters: 200,
    callSlack: 0.0,
    valueRaiseMargin: 0.30,
    valueBetThreshold: 0.56,
    bluffFreq: 0.05,
    betSizeFrac: 0.66,
    noise: 0.01,
    rangeTightness: 0.38,
    exploitGain: 1.0,
    adaptive: true
  }
};

// A deliberately exploitable style used ONLY as a self-play sparring partner
// (never selectable in the UI): a hyper-aggressive station that bets/raises far
// too much and folds too little, so an adaptive bot has a clear read to punish.
export const TEST_TIERS = {
  maniac: {
    key: "maniac",
    name: "Maniac",
    iters: 80,
    callSlack: 0.22,
    valueRaiseMargin: 0.02,
    valueBetThreshold: 0.40,
    bluffFreq: 0.45,
    betSizeFrac: 0.75,
    noise: 0.04
  },
  // A "nit"/rock: over-folds to aggression (negative callSlack ⇒ needs MORE than
  // pot odds to call), only puts chips in with the goods, never bluffs. Its high
  // fold-to-bet is exactly what an adaptive bot should punish by bluffing more.
  nit: {
    key: "nit",
    name: "Nit",
    iters: 80,
    callSlack: -0.14,
    valueRaiseMargin: 0.45,
    valueBetThreshold: 0.70,
    bluffFreq: 0.0,
    betSizeFrac: 0.5,
    noise: 0.03
  }
};

export const TIER_KEYS = Object.keys(TIERS);
