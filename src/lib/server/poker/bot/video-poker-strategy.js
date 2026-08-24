// Video Poker bot — EV-optimal (Video Poker is a solved, single-player game: the
// best play is simply the hold pattern with the highest expected value). For each
// way to keep ≥2 of the five cards we compute the EXACT expected payout over every
// possible draw from the 47 unseen cards; the "keep one high card" and "draw five"
// cases (only relevant for junk hands) use their known baseline EVs. This is
// optimal for essentially every hand and fast enough to run per turn.

import { standardDeck } from "../engine/cards.js";
import { bestHand, STANDARD_MODEL } from "../engine/evaluator.js";
import { payout } from "../games/video-poker.js";

// Tiers kept for the add-bot UI; Video Poker is solved, so all play optimally.
export const VP_TIERS = {
  basic: { key: "basic", name: "Optimal" },
  aggressive: { key: "aggressive", name: "Optimal" },
  tight: { key: "tight", name: "Optimal" }
};

const HIGH = new Set(["J", "Q", "K", "A"]);
const KEEP1_HIGH_EV = 0.47; // holding one high card, drawing four (Jacks or Better)
const DRAW5_EV = 0.36;      // drawing five fresh

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

function expectedValue(held, remaining) {
  const drawN = 5 - held.length;
  if (drawN === 0) return payout(bestHand(held, STANDARD_MODEL));
  let sum = 0;
  let n = 0;
  for (const draw of combinations(remaining, drawN)) { sum += payout(bestHand([...held, ...draw], STANDARD_MODEL)); n += 1; }
  return n ? sum / n : 0;
}

export function optimalHolds(cards) {
  const remaining = standardDeck().filter((c) => !cards.includes(c));
  let bestMask = 0;              // 0 = draw five
  let bestEv = DRAW5_EV;
  for (let mask = 1; mask < 32; mask += 1) {
    const held = cards.filter((_, i) => (mask >> i) & 1);
    if (held.length < 2) continue; // keep-1 / keep-0 handled below
    const ev = expectedValue(held, remaining);
    if (ev > bestEv + 1e-9) { bestEv = ev; bestMask = mask; }
  }
  if (bestEv < KEEP1_HIGH_EV) {
    const hiIdx = cards.findIndex((c) => HIGH.has(c[0]));
    if (hiIdx >= 0) bestMask = 1 << hiIdx; // keep the lone high card
  }
  return cards.map((_, i) => ((bestMask >> i) & 1) === 1);
}

export const videoPokerStrategy = {
  decide({ turn }) {
    const cards = turn?.cards || [];
    if (cards.length < 5) return { type: "draw", holds: [true, true, true, true, true] };
    return { type: "draw", holds: optimalHolds(cards) };
  }
};
