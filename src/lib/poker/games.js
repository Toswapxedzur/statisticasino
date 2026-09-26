// The games the site offers — one per major type (owner, 2026-09-26; the other 22 were deleted, git
// history keeps them). Client-safe catalog: labels, lobby tabs, table layouts and icons (components
// can't import from $lib/server). Keep the keys in sync with the server: engine/variants.js (poker)
// and games/registry.js (the rest).
//
//   key     the table's variant key
//   mode    the lobby tab it lives under ("poker" for Hold'em)
//   layout  which table UI draws it: poker | shed | banked (cards vs the house) | bet (bet spots)
const CATALOG = [
  // lobby order: player-vs-player first, then the house games
  { key: "holdem", mode: "poker", label: "No-Limit Hold'em", short: "NL Hold'em", tab: "Hold'em", layout: "poker" },
  { key: "big-two", mode: "big-two", label: "Big Two", tab: "Big Two", layout: "shed" },
  { key: "blackjack", mode: "blackjack", label: "Blackjack", tab: "Blackjack", layout: "banked" },
  { key: "baccarat", mode: "baccarat", label: "Baccarat", tab: "Baccarat", layout: "bet" },
  { key: "three-card", mode: "three-card", label: "Three Card Poker", tab: "Three Card", layout: "banked" },
  { key: "roulette", mode: "roulette", label: "Roulette", tab: "Roulette", layout: "bet" },
  { key: "sic-bo", mode: "sic-bo", label: "Sic Bo", tab: "Sic Bo", layout: "bet" },
  { key: "slots", mode: "slots", label: "Slots", tab: "Slots", layout: "bet" }
];
const BY_KEY = new Map(CATALOG.map((g) => [g.key, g]));

/** The lobby's tabs, in order: { key (the mode), label, tab (short label) }. */
export const LOBBY_MODES = CATALOG.map((g) => ({ key: g.mode, label: g.mode === "poker" ? "Poker" : g.label, tab: g.tab }));

/** Vs-the-house games (they run on GameTable with a banker). */
export const BANKED_GAMES = CATALOG.filter((g) => g.layout === "banked" || g.layout === "bet").map((g) => g.key);
export function isBanked(key) { return BANKED_GAMES.includes(key); }
/** Shedding games (player-vs-player card play for chips; no house). */
export const SHEDDING_GAMES = CATALOG.filter((g) => g.layout === "shed").map((g) => g.key);
export function isShedding(key) { return SHEDDING_GAMES.includes(key); }

/** Which table layout a game uses — a fixed fact of the game, so a table is drawn in its own layout
 *  from the very first frame (never read off the round's flags, which arrive later). */
export function tableLayout(key) { return BY_KEY.get(key)?.layout ?? "poker"; }

/** The lobby tab a table belongs to. */
export function modeOf(variant) { return BY_KEY.get(variant)?.mode ?? "poker"; }

export function variantLabel(key) { return BY_KEY.get(key)?.label ?? "No-Limit Hold'em"; }
export function variantShort(key) { const g = BY_KEY.get(key); return g?.short ?? g?.label ?? "NL Hold'em"; }

/** The game's icon (static/games, drawn in design/game-icons), for a variant or a lobby mode. */
export function gameIcon(key) {
  const k = key === "poker" ? "holdem" : key;
  return BY_KEY.has(k) ? `/games/${k}.svg` : null;
}
/** The River Sprint event's icon (the stopwatch, design/game-icons/sprint.js). */
export const SPRINT_ICON = "/games/river-sprint.svg";
