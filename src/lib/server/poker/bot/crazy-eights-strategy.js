// Crazy Eights bot. Plays a legal card each turn (saving wild 8s for when it has
// no other legal card, unless "reckless"), declaring its most-held suit on an 8;
// draws when it has nothing. Reads everything from the turn menu.

const bestSuit = (hand) => {
  const counts = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of hand || []) if (c[0] !== "8") counts[c[1]] += 1;
  return ["s", "h", "d", "c"].reduce((a, b) => (counts[b] > counts[a] ? b : a), "s");
};

export const CE_TIERS = {
  basic: { key: "basic", name: "Basic", saveWild: true },
  reckless: { key: "reckless", name: "Reckless", saveWild: false }
};

export const crazyEightsStrategy = {
  decide({ turn, tier }) {
    const t = tier || CE_TIERS.basic;
    if (!turn || !turn.shedGame) return { type: "draw" };
    const legal = turn.legal || [];
    if (!legal.length) return { type: "draw" };
    const nonEight = legal.filter((c) => c[0] !== "8");
    const card = t.saveWild && nonEight.length ? nonEight[0] : legal[0];
    return card[0] === "8" ? { type: "play", card, suit: bestSuit(turn.hand) } : { type: "play", card };
  }
};
