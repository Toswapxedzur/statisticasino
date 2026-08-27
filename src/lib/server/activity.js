// A unified recent-activity feed: money events (rewards, table results,
// tournaments, transfers), achievements, and friendships, merged into one
// reverse-chronological timeline. Sources: chip_ledger, user_achievement,
// friendship. Window: ~200 events / 90 days.

import { query } from "./db.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { identities } from "./profiles.js";

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const ACH = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

// reason -> { label, icon, kind } (kind drives +/- coloring in the UI)
const MONEY = {
  signup_grant: { label: "Welcome bonus", icon: "🎁" },
  daily_bonus: { label: "Daily reward", icon: "🎁" },
  table_buyin: { label: "Sat down at a table", icon: "🪑" },
  table_cashout: { label: "Left a table", icon: "🃏" },
  tourney_entry: { label: "Tournament buy-in", icon: "🏆" },
  tourney_prize: { label: "Tournament prize", icon: "🏆" },
  transfer_send: { label: "Sent chips", icon: "💸" },
  transfer_recv: { label: "Received chips", icon: "💰" },
  admin_adjust: { label: "Adjustment", icon: "⚙️" },
  escrow_refund: { label: "Table refund", icon: "↩️" },
  quest_reward: { label: "Quest reward", icon: "✅" },
  achievement_reward: { label: "Achievement reward", icon: "🏅" },
  sprint_bid: { label: "River Sprint buy-in", icon: "⚡" },
  sprint_prize: { label: "River Sprint prize", icon: "⚡" },
};

export async function recentActivity(userId, { limit = 200, filter = "all" } = {}) {
  const since = Date.now() - NINETY_DAYS;
  const events = [];
  const nameIds = new Set();

  if (filter === "all" || filter === "money") {
    const ledger = await query(
      "SELECT delta, reason, ref, created_at FROM chip_ledger WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?",
      [userId, since, limit]
    );
    for (const r of ledger) {
      const meta = MONEY[r.reason] || { label: r.reason, icon: "•" };
      const isTransfer = r.reason === "transfer_send" || r.reason === "transfer_recv";
      if (isTransfer && r.ref) nameIds.add(r.ref);
      events.push({
        type: "money", ts: Number(r.created_at), reason: r.reason,
        label: meta.label, icon: meta.icon, amount: Number(r.delta), ref: r.ref,
      });
    }
  }

  if (filter === "all" || filter === "achievements") {
    const ach = await query(
      "SELECT achievement, unlocked_at FROM user_achievement WHERE user_id = ? ORDER BY unlocked_at DESC LIMIT 60",
      [userId]
    );
    for (const a of ach) {
      const def = ACH.get(a.achievement);
      events.push({ type: "achievement", ts: Number(a.unlocked_at), icon: "🏅",
        label: `Unlocked "${def?.name || a.achievement}"`, sub: def?.desc || "" });
    }
  }

  if (filter === "all" || filter === "friends") {
    const fr = await query(
      "SELECT requester_id, addressee_id, responded_at FROM friendship "
      + "WHERE status = 'accepted' AND responded_at IS NOT NULL AND (requester_id = ? OR addressee_id = ?) "
      + "ORDER BY responded_at DESC LIMIT 60",
      [userId, userId]
    );
    for (const f of fr) {
      const other = f.requester_id === userId ? f.addressee_id : f.requester_id;
      nameIds.add(other);
      events.push({ type: "friend", ts: Number(f.responded_at), icon: "🤝", ref: other, label: "Became friends" });
    }
  }

  // Resolve names for transfers + friend events.
  const info = await identities([...nameIds]);
  for (const e of events) {
    if (e.ref && info.has(e.ref)) {
      const name = info.get(e.ref).name;
      if (e.type === "friend") e.label = `Became friends with ${name}`;
      else if (e.reason === "transfer_send") e.label = `Sent chips to ${name}`;
      else if (e.reason === "transfer_recv") e.label = `Received chips from ${name}`;
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit);
}
