// Achievements — pure STATUS badges. They grant NO chips (retention is visible,
// not monetary). The catalog lives here in code; unlocked rows live in the
// `user_achievement` table. Unlock is idempotent (INSERT IGNORE on the PK), so a
// trigger firing twice never double-awards.
//
// The trigger LOGIC is split into pure functions (streakAchievements /
// handAchievements) that map an event to the keys it earns — trivially testable —
// and a thin DB layer (unlock / listForUser) with an injectable `db` so tests run
// without MySQL.

import * as realDb from "./db.js";

export const ACHIEVEMENTS = [
  { key: "first_hand", name: "First Hand", desc: "Play your first hand." },
  { key: "first_win", name: "First Blood", desc: "Win your first pot." },
  { key: "hands_100", name: "Centurion", desc: "Play 100 hands." },
  { key: "hands_1000", name: "Grinder", desc: "Play 1,000 hands." },
  { key: "bot_slayer", name: "Bot Slayer", desc: "Win a pot with a bot at the table." },
  { key: "all_in_win", name: "No Fear", desc: "Win an all-in showdown." },
  { key: "big_pot", name: "Stack Attack", desc: "Win a pot of 1,000+ chips." },
  { key: "streak_3", name: "Warming Up", desc: "Reach a 3-day login streak." },
  { key: "streak_7", name: "Regular", desc: "Reach a 7-day login streak." },
  { key: "streak_30", name: "Devotee", desc: "Reach a 30-day login streak." }
];

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
  if (won) {
    out.push("first_win");
    if (vsBot) out.push("bot_slayer");
    if (allInWin) out.push("all_in_win");
    if ((potWon || 0) >= 1000) out.push("big_pot");
  }
  return out;
}

// Idempotently unlock a set of keys for a user. Returns the keys that were NEWLY
// unlocked (so the caller can notify). Unknown keys are ignored.
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

// The full catalog annotated with this user's unlocked state, for the badge grid.
export async function listForUser(userId, db = realDb) {
  const rows = await db.query(
    "SELECT achievement, unlocked_at FROM user_achievement WHERE user_id = ?",
    [userId]
  );
  const at = new Map(rows.map((r) => [r.achievement, Number(r.unlocked_at)]));
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: at.has(a.key), unlockedAt: at.get(a.key) ?? null }));
}
