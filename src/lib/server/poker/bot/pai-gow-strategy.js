// Pai Gow bot: always set the hand the house way (the module's bestSplit). The
// only decision is how to split, and the optimal-ish split is the sensible play.

export const PG_TIERS = {
  house: { key: "house", name: "House way" }
};

export const paiGowStrategy = {
  decide({ turn }) {
    if (turn.phase !== "set") return { type: "set", auto: true };
    return { type: "set", auto: true };
  }
};
