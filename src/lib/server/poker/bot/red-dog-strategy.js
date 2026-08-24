// Red Dog bot. Post the ante (flat), then raise only when the spread is wide
// enough that doubling is +EV (a third card lands inside with probability
// ~4×spread/50, and the payout drops to 1:1 once the spread reaches 4, so raising
// is only worth it around spread 7+). Tiers shift that threshold.

export const RD_TIERS = {
  basic: { key: "basic", name: "Basic", threshold: 7, betUnits: 1 },
  aggressive: { key: "aggressive", name: "Aggressive", threshold: 4, betUnits: 1 },
  tight: { key: "tight", name: "Tight", threshold: 99, betUnits: 1 } // never raises
};

export const redDogStrategy = {
  decide({ turn, tier }) {
    const t = tier || RD_TIERS.basic;
    const actions = turn.actions || [];
    if (turn.phase === "ante") {
      const ante = actions.find((a) => a.type === "ante");
      if (!ante) return { type: "check" };
      return { type: "ante", amount: Math.max(ante.min, Math.min(ante.max, ante.min * (t.betUnits || 1))) };
    }
    const canRaise = actions.some((a) => a.type === "raise");
    if (canRaise && (turn.spread ?? 0) >= t.threshold) return { type: "raise" };
    return { type: "check" };
  }
};
