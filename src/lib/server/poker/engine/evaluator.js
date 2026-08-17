import { RANKS, SUITS } from "./cards.js";

const CATEGORY_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush"
];

const RANK_VALUE = new Map([...RANKS].map((rank, index) => [rank, index + 2]));

function assertCards(cards, count) {
  if (!Array.isArray(cards) || cards.length !== count) {
    throw new TypeError(`expected exactly ${count} cards`);
  }
  const seen = new Set();
  for (const card of cards) {
    if (
      typeof card !== "string" ||
      card.length !== 2 ||
      !RANKS.includes(card[0]) ||
      !SUITS.includes(card[1])
    ) {
      throw new TypeError(`invalid card: ${String(card)}`);
    }
    if (seen.has(card)) throw new RangeError(`duplicate card: ${card}`);
    seen.add(card);
  }
}

// Returns the straight's high card, treating A-2-3-4-5 as five-high.
function straightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  return null;
}

function evaluate5(cards) {
  const values = cards.map((card) => RANK_VALUE.get(card[0]));
  const suits = cards.map((card) => card[1]);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const groups = [...counts.entries()].sort(
    ([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA
  );
  const descending = [...values].sort((a, b) => b - a);
  const flush = suits.every((suit) => suit === suits[0]);
  const straight = straightHigh(values);

  let category;
  let ranks;

  if (flush && straight !== null) {
    category = 8;
    ranks = [straight];
  } else if (groups[0][1] === 4) {
    category = 7;
    ranks = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    ranks = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
    ranks = descending;
  } else if (straight !== null) {
    category = 4;
    ranks = [straight];
  } else if (groups[0][1] === 3) {
    category = 3;
    ranks = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    category = 2;
    ranks = [...pairs, groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = 1;
    ranks = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  } else {
    category = 0;
    ranks = descending;
  }

  return { category, ranks, name: CATEGORY_NAMES[category] };
}

// Compare category first, then category-specific kickers. A positive
// result means `a` is stronger; this is an ascending-strength comparator.
export function compareRank(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < length; i += 1) {
    const difference = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Clarity wins here: inspect all C(7,5) combinations and retain the best.
export function evaluate7(cards7) {
  assertCards(cards7, 7);
  let best = null;

  for (let a = 0; a < 3; a += 1) {
    for (let b = a + 1; b < 4; b += 1) {
      for (let c = b + 1; c < 5; c += 1) {
        for (let d = c + 1; d < 6; d += 1) {
          for (let e = d + 1; e < 7; e += 1) {
            const rank = evaluate5([cards7[a], cards7[b], cards7[c], cards7[d], cards7[e]]);
            if (best === null || compareRank(rank, best) > 0) best = rank;
          }
        }
      }
    }
  }

  return best;
}
