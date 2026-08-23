// Generic bot for bet-selection games (baccarat, roulette, sic-bo …). There's no
// hand to play, so it just flat-bets a configured option (the tier's `betOption`,
// e.g. the lowest-house-edge one) each round. A tier factory keeps per-game tiers
// declarative.

export function betGameTiers(spec) {
  // spec: [{ key, name, betOption }] — betUnits default 1.
  const tiers = {};
  for (const t of spec) tiers[t.key] = { key: t.key, name: t.name, betOption: t.betOption, betUnits: t.betUnits || 1 };
  return tiers;
}

export const betGameStrategy = {
  decide({ turn, tier }) {
    const opts = turn.betOptions || [];
    if (!opts.length) return { type: "bet", bets: [] };
    const key = tier?.betOption && opts.some((o) => o.key === tier.betOption) ? tier.betOption : opts[0].key;
    const amount = (turn.minBet || 1) * (tier?.betUnits || 1);
    return { type: "bet", bets: [{ option: key, amount }] };
  }
};

// Per-game tiers.
export const BACCARAT_TIERS = betGameTiers([
  { key: "banker", name: "Banker", betOption: "banker" }, // lowest house edge — the default
  { key: "player", name: "Player", betOption: "player" },
  { key: "tie", name: "Tie", betOption: "tie" }
]);

export const ROULETTE_TIERS = betGameTiers([
  { key: "red", name: "Red", betOption: "red" }, // even-money grinder — the default
  { key: "black", name: "Black", betOption: "black" },
  { key: "lucky", name: "Lucky 7", betOption: "n7" } // straight-up 35:1 gambler
]);

export const SIC_BO_TIERS = betGameTiers([
  { key: "small", name: "Small", betOption: "small" }, // even-money grinder — the default
  { key: "big", name: "Big", betOption: "big" },
  { key: "triple", name: "Any Triple", betOption: "anytriple" } // 30:1 gambler
]);

export const DRAGON_TIGER_TIERS = betGameTiers([
  { key: "dragon", name: "Dragon", betOption: "dragon" },
  { key: "tiger", name: "Tiger", betOption: "tiger" },
  { key: "tie", name: "Tie", betOption: "tie" }
]);

export const CASINO_WAR_TIERS = betGameTiers([
  { key: "ante", name: "Player", betOption: "ante" }, // the main bet — default
  { key: "tie", name: "Tie", betOption: "tie" }
]);

export const ANDAR_BAHAR_TIERS = betGameTiers([
  { key: "bahar", name: "Bahar", betOption: "bahar" }, // pays full 1:1 — default
  { key: "andar", name: "Andar", betOption: "andar" }
]);

export const MONEY_WHEEL_TIERS = betGameTiers([
  { key: "one", name: "$1", betOption: "1" }, // most common slot — default
  { key: "twenty", name: "$20", betOption: "20" },
  { key: "joker", name: "Joker", betOption: "joker" } // 45:1 gambler
]);
