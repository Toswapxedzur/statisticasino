// Big Two bot: play the WEAKEST legal combo that beats the current play (so it
// hoards strength), else pass; when leading, open with the lowest single (including
// the mandatory lowest card on the opening play). Enumerates combos of the pile's
// size from its hand — cheap (≤ C(13,5)).

import { classifyPlay, comparePlay, cardKey } from "../games/big-two.js";

export const BT_TIERS = {
  basic: { key: "basic", name: "Basic" },
  leader: { key: "leader", name: "Aggressive" } // dumps its lowest lead each time (same play here)
};

function* combinations(items, k) {
  const n = items.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => items[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i -= 1;
    if (i < 0) return;
    idx[i] += 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = idx[j - 1] + 1;
  }
}

function legalPlaysOfSize(hand, size) {
  const out = [];
  for (const combo of combinations(hand, size)) {
    const cls = classifyPlay(combo);
    if (cls) out.push({ cards: combo, cls });
  }
  return out;
}

export const bigTwoStrategy = {
  decide({ turn }) {
    if (!turn || !turn.shedGame) return { type: "pass" };
    const hand = turn.hand || [];

    if (turn.pileCards && turn.pileCards.length) {
      const pile = classifyPlay(turn.pileCards);
      if (!pile) return { type: "pass" };
      const beats = legalPlaysOfSize(hand, pile.size).filter((c) => comparePlay(c.cls, pile) > 0);
      if (!beats.length) return { type: "pass" };
      beats.sort((a, b) => comparePlay(a.cls, b.cls)); // weakest that still beats
      return { type: "play", cards: beats[0].cards };
    }

    // Leading a fresh round: open with the lowest single (incl. the forced card).
    if (turn.mustInclude) return { type: "play", cards: [turn.mustInclude] };
    const lowest = [...hand].sort((a, b) => cardKey(a) - cardKey(b))[0];
    return { type: "play", cards: [lowest] };
  }
};
