import { RANKS, SUITS } from "./cards.js";

// Hand types, weakest-first. A "rank model" maps these to comparable category
// numbers; different variants order them differently (short deck floats a flush
// above a full house). Standard poker = this exact order (index === category).
const HAND_TYPES = [
  "high", "pair", "twopair", "trips", "straight", "flush", "fullhouse", "quads", "straightflush"
];

const TYPE_NAME = {
  high: "High Card", pair: "One Pair", twopair: "Two Pair", trips: "Three of a Kind",
  straight: "Straight", flush: "Flush", fullhouse: "Full House",
  quads: "Four of a Kind", straightflush: "Straight Flush"
};

// A rank model = the category ordering + which value an ace takes when it plays
// low in a wheel. Standard: A-2-3-4-5 (ace low = 1). Short deck: A-6-7-8-9 is the
// wheel (ace low = 5) and a flush outranks a full house.
export const STANDARD_MODEL = { order: HAND_TYPES, aceLowValue: 1 };
export const SHORTDECK_MODEL = {
  order: ["high", "pair", "twopair", "trips", "straight", "fullhouse", "flush", "quads", "straightflush"],
  aceLowValue: 5
};

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

// Returns the straight's high card. `aceLowValue` is the value an ace takes as
// the bottom of a wheel (1 for a 52-card deck, 5 for short deck's A-6-7-8-9).
function straightHigh(values, aceLowValue) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(aceLowValue);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  return null;
}

// Classify a 5-card hand into { type, ranks } — the variant-independent shape.
// `ranks` are the tiebreak values, most significant first.
function classify5(cards, aceLowValue) {
  const values = cards.map((card) => RANK_VALUE.get(card[0]));
  const suits = cards.map((card) => card[1]);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const groups = [...counts.entries()].sort(
    ([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA
  );
  const descending = [...values].sort((a, b) => b - a);
  const flush = suits.every((suit) => suit === suits[0]);
  const straight = straightHigh(values, aceLowValue);

  if (flush && straight !== null) return { type: "straightflush", ranks: [straight] };
  if (groups[0][1] === 4) return { type: "quads", ranks: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { type: "fullhouse", ranks: [groups[0][0], groups[1][0]] };
  if (flush) return { type: "flush", ranks: descending };
  if (straight !== null) return { type: "straight", ranks: [straight] };
  if (groups[0][1] === 3) {
    return { type: "trips", ranks: [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)] };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return { type: "twopair", ranks: [...pairs, groups[2][0]] };
  }
  if (groups[0][1] === 2) {
    return { type: "pair", ranks: [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)] };
  }
  return { type: "high", ranks: descending };
}

// Rank a 5-card hand under a model → { category, ranks, name } (category is
// model-relative, so ranks from the SAME model are directly comparable).
function rank5(cards, model = STANDARD_MODEL) {
  const { type, ranks } = classify5(cards, model.aceLowValue);
  return { category: model.order.indexOf(type), ranks, name: TYPE_NAME[type] };
}

// Compare category first, then category-specific kickers. A positive result
// means `a` is stronger; ascending-strength comparator. Both operands must come
// from the same rank model.
export function compareRank(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < length; i += 1) {
    const difference = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

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

// Best 5-card hand out of any number of cards (>=5), under `model`.
export function bestHand(cards, model = STANDARD_MODEL) {
  let best = null;
  for (const five of combinations(cards, 5)) {
    const rank = rank5(five, model);
    if (best === null || compareRank(rank, best) > 0) best = rank;
  }
  return best;
}

// Omaha-style: the best 5-card hand using EXACTLY 2 hole cards + EXACTLY 3 board
// cards. board must have >= 3 cards.
export function bestOmaha(hole, board, model = STANDARD_MODEL) {
  let best = null;
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const rank = rank5([...h, ...b], model);
      if (best === null || compareRank(rank, best) > 0) best = rank;
    }
  }
  return best;
}

// Standard Texas Hold'em: best 5 of exactly 7 cards. Kept as a named export with
// its strict 7-card contract because the engine + bots depend on it directly.
export function evaluate7(cards7) {
  assertCards(cards7, 7);
  return bestHand(cards7, STANDARD_MODEL);
}

// --- Ace-to-5 low ("8 or better"), for hi-lo split games ---------------------
// A qualifying low is five distinct ranks all 8 or lower (ace plays low). Read
// high-card-first, the LOWER hand wins (the wheel A-2-3-4-5 is the best low).
function lowFive(cards) {
  const values = cards.map((card) => {
    const rank = card[0];
    if (rank === "A") return 1;
    if ("TJQK".includes(rank)) return 99; // never low
    return Number(rank);
  });
  if (values.some((v) => v > 8)) return null;      // a 9+ card can't make a low
  if (new Set(values).size !== 5) return null;      // a pair breaks the low
  return { lowRanks: values.sort((a, b) => b - a) }; // highest first
}

// Compare two lows: negative if `a` is the BETTER (lower) low.
export function compareLowRanks(a, b) {
  for (let i = 0; i < 5; i += 1) {
    const d = a.lowRanks[i] - b.lowRanks[i];
    if (d !== 0) return d;
  }
  return 0;
}

// Best Omaha low: the lowest qualifying 5-card low using EXACTLY 2 hole + 3 board.
// Returns { lowRanks } or null when no 8-or-better low is possible.
export function bestOmahaLow(hole, board) {
  let best = null;
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const low = lowFive([...h, ...b]);
      if (low && (best === null || compareLowRanks(low, best) < 0)) best = low;
    }
  }
  return best;
}
