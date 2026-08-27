// Quests — daily / weekly / monthly objectives that drive the daily-return
// loop. Like achievements.js, the CATALOG lives here in code (QUESTS) and only
// per-user progress is persisted (quest_progress). Progress is keyed by
// (user, quest, period_key); period_key buckets the reset window so a new
// day/week/month naturally starts fresh rows — there is no cron reset job.
//
// Progress is driven by gameplay events routed through recordEvent(), which the
// poker hub calls on each finished hand (and other call sites for logins / event
// entries). Completed quests pay chips via wallet.credit(REASON.QUEST_REWARD).
//
// The DB layer takes an injectable `db` (and claim() an injectable wallet) so the
// pure logic — period bucketing, progress capping, claim idempotency — is unit
// testable without MySQL, exactly like achievements.js.

import * as realDb from "./db.js";
import * as realWallet from "./wallet.js";
import { REASON } from "./wallet.js";

// ------------------------------------------------------------- catalog
//
// objective = the event type recordEvent() is called with. Keep objective
// strings stable — they're matched against, not persisted per-row, but the
// quest `id`s ARE persisted in quest_progress, so those must stay stable.
export const QUESTS = [
  // --- daily (small, fast, reset every UTC day) ---
  { id: "d_play_10",   period: "daily",   objective: "hands_played", target: 10,  reward: 500,  title: "Play 10 hands" },
  { id: "d_win_3",     period: "daily",   objective: "pots_won",     target: 3,   reward: 500,  title: "Win 3 pots" },
  { id: "d_login",     period: "daily",   objective: "daily_login",  target: 1,   reward: 200,  title: "Claim your daily reward" },
  // --- weekly (medium, reset every ISO week) ---
  { id: "w_play_150",  period: "weekly",  objective: "hands_played", target: 150, reward: 3000, title: "Play 150 hands this week" },
  { id: "w_win_40",    period: "weekly",  objective: "pots_won",     target: 40,  reward: 3000, title: "Win 40 pots this week" },
  { id: "w_sprint_3",  period: "weekly",  objective: "sprint_enter", target: 3,   reward: 4000, title: "Enter 3 River Sprints" },
  // --- monthly (the big one — usually points at the event) ---
  { id: "m_play_600",  period: "monthly", objective: "hands_played", target: 600, reward: 12000, title: "Play 600 hands this month" },
  { id: "m_sprint_win", period: "monthly", objective: "sprint_cash", target: 1,   reward: 15000, title: "Cash in a River Sprint" },
];

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));
export const PERIODS = ["daily", "weekly", "monthly"];

// ------------------------------------------------------------- period keys
//
// Bucket a timestamp into the reset window for a period. UTC throughout so the
// boundary is stable regardless of server locale. daily → 'YYYY-MM-DD',
// monthly → 'YYYY-MM', weekly → ISO-8601 week 'YYYY-Www'.
export function periodKey(period, at = Date.now()) {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (period === "daily") return `${y}-${mm}-${dd}`;
  if (period === "monthly") return `${y}-${mm}`;
  if (period === "weekly") {
    // ISO week number: the week (Mon–Sun) containing the year's first Thursday
    // is week 1. Compute via the Thursday of the current week.
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (t.getUTCDay() + 6) % 7;          // Mon=0 … Sun=6
    t.setUTCDate(t.getUTCDate() - dayNum + 3);        // move to Thursday of this week
    const isoYear = t.getUTCFullYear();
    const firstThu = new Date(Date.UTC(isoYear, 0, 4));
    const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }
  return "all";
}

// ------------------------------------------------------------- writes
//
// Advance every active quest whose objective matches `objective` by `amount`
// (default 1), capped at that quest's target. Best-effort and idempotent-ish:
// re-running with the same event over-counts by design (each event is a real
// occurrence), but progress never exceeds target. Called fire-and-forget from
// gameplay, so it must never throw into the caller.
export async function recordEvent(userId, objective, amount = 1, db = realDb, at = Date.now()) {
  if (!userId || !objective || !(amount > 0)) return;
  const matches = QUESTS.filter((q) => q.objective === objective);
  for (const q of matches) {
    const pk = periodKey(q.period, at);
    const seed = Math.min(q.target, amount);
    try {
      await db.execute(
        `INSERT INTO quest_progress (user_id, quest_id, period_key, progress, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE progress = LEAST(?, progress + ?), updated_at = ?`,
        [userId, q.id, pk, seed, at, q.target, amount, at]
      );
    } catch { /* quest progress is best-effort; never disrupt gameplay */ }
  }
}

// ------------------------------------------------------------- reads
//
// The full catalog annotated with this user's current-period progress, for the
// /quests UI. One query loads all of the user's progress rows; we match each
// quest against its CURRENT period_key (older rows are ignored history).
export async function activeQuestsFor(userId, db = realDb, at = Date.now()) {
  const rows = await db.query(
    "SELECT quest_id, period_key, progress, claimed_at FROM quest_progress WHERE user_id = ?",
    [userId]
  );
  const byKey = new Map(rows.map((r) => [`${r.quest_id}|${r.period_key}`, r]));
  return QUESTS.map((q) => {
    const pk = periodKey(q.period, at);
    const r = byKey.get(`${q.id}|${pk}`);
    const progress = r ? Math.min(q.target, Number(r.progress)) : 0;
    const claimed = !!(r && r.claimed_at);
    return {
      id: q.id, period: q.period, title: q.title, objective: q.objective,
      target: q.target, reward: q.reward, progress,
      done: progress >= q.target, claimed, periodKey: pk,
    };
  });
}

// ------------------------------------------------------------- claim
//
// Redeem a completed quest's reward. Atomic + idempotent: the conditional UPDATE
// only flips claimed_at when the quest is done AND unclaimed for the CURRENT
// period, so exactly one call can win (guards double-claim). Only after that
// win do we credit chips. Ordering is claim-then-pay so a crash between the two
// can never double-pay (at worst it under-pays a rare failed credit, which the
// ledger makes visible).
export async function claim(userId, questId, db = realDb, wallet = realWallet, at = Date.now()) {
  const q = BY_ID.get(questId);
  if (!q) return { ok: false, error: "unknown_quest" };
  const pk = periodKey(q.period, at);
  const res = await db.execute(
    `UPDATE quest_progress SET claimed_at = ?
       WHERE user_id = ? AND quest_id = ? AND period_key = ?
         AND claimed_at IS NULL AND progress >= ?`,
    [at, userId, questId, pk, q.target]
  );
  if ((res.affectedRows ?? 0) === 0) return { ok: false, error: "not_claimable" };
  let balance = null;
  if (q.reward > 0) {
    try { balance = await wallet.credit(userId, q.reward, REASON.QUEST_REWARD, `quest:${questId}`); }
    catch { /* claim is recorded; a failed credit is visible in the ledger gap */ }
  }
  return { ok: true, reward: q.reward, balance };
}
