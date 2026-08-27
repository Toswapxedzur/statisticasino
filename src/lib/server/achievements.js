// Achievements — milestone badges. Historically pure STATUS (no chips); as of the
// progression phase (2026-08-27) most badges also grant a one-time chip REWARD.
// The catalog lives here in code; unlocked rows live in `user_achievement`.
// Unlock is idempotent (INSERT IGNORE on the PK), so a trigger firing twice never
// double-awards — and the reward, paid only for NEWLY-unlocked keys, is therefore
// also paid at most once.
//
// The trigger LOGIC is split into pure functions (streakAchievements /
// handAchievements / progressFor) that map an event to keys — trivially testable —
// and a DB layer (unlock / listForUser) with an injectable `db`. `unlock` stays
// pure (DB only); `unlockAndReward` layers chip payouts on top for the real call
// sites, keeping the reward path out of the unit-tested core.

import * as realDb from "./db.js";
import * as realWallet from "./wallet.js";
import { REASON } from "./wallet.js";

// Category labels for grouping the badge grid.
export const CATEGORIES = { volume: "Volume", skill: "Skill", dedication: "Dedication", event: "Events" };

export const ACHIEVEMENTS = [
  // --- volume (lifetime hands) ---
  { key: "first_hand",  name: "First Hand",  desc: "Play your first hand.",  category: "volume", reward: 100 },
  { key: "hands_100",   name: "Centurion",   desc: "Play 100 hands.",        category: "volume", tier: "bronze", reward: 500 },
  { key: "hands_1000",  name: "Grinder",     desc: "Play 1,000 hands.",      category: "volume", tier: "silver", reward: 2500 },
  { key: "hands_10000", name: "Marathoner",  desc: "Play 10,000 hands.",     category: "volume", tier: "gold",   reward: 12000 },
  // --- skill (winning) ---
  { key: "first_win",   name: "First Blood", desc: "Win your first pot.",             category: "skill", reward: 200 },
  { key: "bot_slayer",  name: "Bot Slayer",  desc: "Win a pot with a bot at the table.", category: "skill", reward: 200 },
  { key: "all_in_win",  name: "No Fear",     desc: "Win an all-in showdown.",         category: "skill", reward: 300 },
  { key: "big_pot",     name: "Stack Attack", desc: "Win a pot of 1,000+ chips.",     category: "skill", tier: "bronze", reward: 500 },
  { key: "whale_pot",   name: "Leviathan",   desc: "Win a pot of 10,000+ chips.",     category: "skill", tier: "gold",   reward: 5000 },
  // --- dedication (login streaks) ---
  { key: "streak_3",    name: "Warming Up",  desc: "Reach a 3-day login streak.",   category: "dedication", tier: "bronze", reward: 300 },
  { key: "streak_7",    name: "Regular",     desc: "Reach a 7-day login streak.",   category: "dedication", tier: "silver", reward: 700 },
  { key: "streak_30",   name: "Devotee",     desc: "Reach a 30-day login streak.",  category: "dedication", tier: "gold",   reward: 3000 },
  // --- events (River Sprint) — awarded by the event engine (P4); locked until then ---
  { key: "sprint_itm",   name: "In the Money",   desc: "Finish in the paid places of a River Sprint.", category: "event", reward: 1000 },
  { key: "sprint_final", name: "Final Cut",      desc: "Reach the final table of a River Sprint.",     category: "event", tier: "silver", reward: 2500 },
  { key: "sprint_champ", name: "River Champion", desc: "Win a River Sprint.",                          category: "event", tier: "gold",   reward: 8000 },
];

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
const KEYS = new Set(ACHIEVEMENTS.map((a) => a.key));

// Milestone badges a given login streak satisfies (cumulative — a 30-day streak
// also holds the 3- and 7-day badges; unlock is idempotent so re-awarding is fine).
export function streakAchievements(streak) {
  const out = [];
  if (streak >= 3) out.push("streak_3");
  if (streak >= 7) out.push("streak_7");
  if (streak >= 30) out.push("streak_30");
  return out;
}

// Badges a single finished hand earns for one player. `handsPlayed` is that
// player's running LIFETIME hand count AFTER this hand (the caller supplies it).
export function handAchievements({ won, vsBot, allInWin, potWon, handsPlayed }) {
  const out = ["first_hand"];
  if (handsPlayed >= 100) out.push("hands_100");
  if (handsPlayed >= 1000) out.push("hands_1000");
  if (handsPlayed >= 10000) out.push("hands_10000");
  if (won) {
    out.push("first_win");
    if (vsBot) out.push("bot_slayer");
    if (allInWin) out.push("all_in_win");
    const p = potWon || 0;
    if (p >= 1000) out.push("big_pot");
    if (p >= 10000) out.push("whale_pot");
  }
  return out;
}

// Progress toward a laddered badge, for the "how close am I" bar on locked badges.
// Returns { value, target } for hand-count and streak ladders, else null.
export function progressFor(key, { handsPlayed = 0, streak = 0 } = {}) {
  const ladders = {
    hands_100: ["hands", 100], hands_1000: ["hands", 1000], hands_10000: ["hands", 10000],
    streak_3: ["streak", 3], streak_7: ["streak", 7], streak_30: ["streak", 30],
  };
  const l = ladders[key];
  if (!l) return null;
  const val = l[0] === "hands" ? handsPlayed : streak;
  return { value: Math.max(0, Math.min(val, l[1])), target: l[1] };
}

// Idempotently unlock a set of keys for a user. Returns the keys that were NEWLY
// unlocked (so the caller can notify / reward). Unknown keys are ignored. Pure DB
// — no chip payout (see unlockAndReward for that).
export async function unlock(userId, keys, db = realDb) {
  if (!userId || !keys || keys.length === 0) return [];
  const fresh = [];
  const now = Date.now();
  for (const key of keys) {
    if (!KEYS.has(key)) continue;
    const res = await db.execute(
      "INSERT IGNORE INTO user_achievement (user_id, achievement, unlocked_at) VALUES (?, ?, ?)",
      [userId, key, now]
    );
    if ((res.affectedRows ?? 0) > 0) fresh.push(key);
  }
  return fresh;
}

// unlock() + pay each newly-earned badge's one-time chip reward. Payout is
// best-effort and keyed `ach:<key>` in the ledger for traceability. Used by the
// live call sites (hub, account); tests exercise the pure `unlock` instead.
export async function unlockAndReward(userId, keys, db = realDb, wallet = realWallet) {
  const fresh = await unlock(userId, keys, db);
  for (const key of fresh) {
    const reward = BY_KEY.get(key)?.reward || 0;
    if (reward > 0) {
      try { await wallet.credit(userId, reward, REASON.ACHIEVEMENT_REWARD, `ach:${key}`); }
      catch { /* unlock is recorded; a failed credit is visible as a ledger gap */ }
    }
  }
  return fresh;
}

// The full catalog annotated with this user's unlocked state (+ progress toward
// locked laddered badges when `ctx` supplies handsPlayed / streak), for the grid.
export async function listForUser(userId, db = realDb, ctx = {}) {
  const rows = await db.query(
    "SELECT achievement, unlocked_at FROM user_achievement WHERE user_id = ?",
    [userId]
  );
  const at = new Map(rows.map((r) => [r.achievement, Number(r.unlocked_at)]));
  return ACHIEVEMENTS.map((a) => {
    const unlocked = at.has(a.key);
    return {
      ...a,
      unlocked,
      unlockedAt: at.get(a.key) ?? null,
      progress: unlocked ? null : progressFor(a.key, ctx),
    };
  });
}
