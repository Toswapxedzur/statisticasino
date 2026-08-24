// Keno bot. One decision: mark some spots and bet. It picks a fixed count of
// random distinct numbers (via the injected rng) and flat-bets the minimum.

export const KENO_TIERS = {
  casual: { key: "casual", name: "Casual (4 spots)", spots: 4, betUnits: 1 },
  chaser: { key: "chaser", name: "Jackpot chaser (8)", spots: 8, betUnits: 1 }
};

export const kenoStrategy = {
  decide({ turn, tier, rng }) {
    const t = tier || KENO_TIERS.casual;
    if (turn.phase !== "pick") return { type: "pick", spots: [], amount: 0 };
    const r = typeof rng === "function" ? rng : Math.random;
    const want = Math.min(t.spots || 4, turn.maxSpots || 10);
    const spots = new Set();
    let guard = 0;
    while (spots.size < want && guard++ < 400) spots.add(1 + Math.floor(r() * 80));
    const amount = (turn.minBet || 1) * (t.betUnits || 1);
    return { type: "pick", spots: [...spots], amount };
  }
};
