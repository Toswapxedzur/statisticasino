// Big Two bot — θ-scored (no binary "endgame mode"). Every candidate play is
// scored as   tempo(a) + θ · control(a)   and the max is chosen, where:
//   tempo(a)   = how efficiently `a` sheds (fewer remaining rank-groups, no
//                fragmenting of pairs/triples)
//   control(a) = how much `a` keeps the initiative (strength → likely to hold the
//                lead / stop a short opponent)
//   θ          = a continuous THREAT coefficient that rises smoothly as an
//                opponent nears zero, we fall behind, or the field grows — so the
//                bot slides from "shed fast" to "seize and hold the lead" rather
//                than flipping a switch. Tunable via self-play.

import { classifyPlay, comparePlay, cardKey } from "../games/big-two.js";

export const BT_TIERS = {
  basic: { key: "basic", name: "Basic", thetaScale: 1.0 },
  leader: { key: "leader", name: "Aggressive", thetaScale: 1.5 } // weights control higher
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

function enumerate(hand, size) {
  const out = [];
  for (const combo of combinations(hand, size)) { const cls = classifyPlay(combo); if (cls) out.push({ cards: combo, cls }); }
  return out;
}
const enumerateAll = (hand) => [1, 2, 3, 5].flatMap((s) => enumerate(hand, s));

// --- value functions ---------------------------------------------------------
const rounds = (hand) => new Set(hand.map((c) => c[0])).size; // ~plays to empty (each rank dumped together)
function fragments(cards, hand) {
  const have = {};
  for (const c of hand) have[c[0]] = (have[c[0]] || 0) + 1;
  const use = {};
  for (const c of cards) use[c[0]] = (use[c[0]] || 0) + 1;
  let f = 0;
  for (const r in use) if (use[r] < have[r]) f += 1; // took some of a group, left a fragment
  return f;
}
function tempo(cards, hand) {
  const after = hand.filter((c) => !cards.includes(c));
  return -rounds(after) - 0.7 * fragments(cards, hand);
}

function threat(counts, mySeat) {
  const active = counts && counts.length ? counts : [{ seat: mySeat, n: 1 }];
  const opp = active.filter((c) => c.seat !== mySeat);
  if (!opp.length) return 0;
  const minOpp = Math.min(...opp.map((c) => c.n));
  const mine = (active.find((c) => c.seat === mySeat) || { n: 13 }).n;
  const f = ((13 - minOpp) / 13) ** 2;                 // convex: ramps up as an opponent nears 0
  const behind = Math.max(0, (mine - minOpp) / 13);    // we're losing the race
  const field = (opp.length - 1) / 3;                    // more opponents, more danger
  return 1.0 * f + 0.3 * behind + 0.2 * field;
}

export const bigTwoStrategy = {
  decide({ turn, tier, seat }) {
    if (!turn || !turn.shedGame) return { type: "pass" };
    const hand = turn.hand || [];
    const theta = threat(turn.counts, seat) * (tier?.thetaScale ?? 1);

    // strength for singles needs the actual card; recompute control inline.
    const strength = (c) => {
      if (c.cls.size === 5) return c.cls.rank.category / 8;
      if (c.cls.size === 1) return cardKey(c.cards[0]) / 63;
      return c.cls.key / 15;
    };

    let candidates;
    if (turn.pileCards && turn.pileCards.length) {
      const pile = classifyPlay(turn.pileCards);
      candidates = enumerate(hand, pile.size).filter((c) => comparePlay(c.cls, pile) > 0);
      candidates.push({ pass: true });
    } else {
      candidates = enumerateAll(hand).filter((c) => !turn.mustInclude || c.cards.includes(turn.mustInclude));
      if (!candidates.length) candidates = enumerate(hand, 1); // safety
    }

    // Small negative bias so that when θ≈0 the bot hoards strength (plays the
    // weakest sufficient card); as θ grows, control dominates and it spends
    // strength to hold the lead.
    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const score = c.pass ? -rounds(hand) : tempo(c.cards, hand) + (theta - 0.05) * strength(c);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || best.pass) return { type: "pass" };
    return { type: "play", cards: best.cards };
  }
};
