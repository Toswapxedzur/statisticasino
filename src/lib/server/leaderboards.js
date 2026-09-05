// Leaderboards: metric (chips | net winnings) × timeframe (all | week | month) ×
// scope (global | friends). Chips = current wallet balance (timeframe N/A); net =
// SUM of per-hand results over the window.
import { query } from "./db.js";

const BOTS = "email NOT LIKE '%@bot.bluffingvalley.invalid'";
function windowStart(tf) {
  const now = Date.now();
  if (tf === "week") return now - 7 * 86400000;
  if (tf === "month") return now - 30 * 86400000;
  return 0;
}

async function friendScope(viewerId) {
  if (!viewerId) return [];
  const rows = await query(
    "SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid "
    + "FROM friendship WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)",
    [viewerId, viewerId, viewerId]
  );
  return [...new Set([viewerId, ...rows.map((r) => r.fid)])];
}

export async function getLeaderboard({ metric = "chips", timeframe = "all", scope = "global", viewerId = null, limit = 50 }) {
  let friendIds = null;
  if (scope === "friends") {
    friendIds = await friendScope(viewerId);
    if (!friendIds.length) return [];
  }

  if (metric === "chips") {
    let sql = `SELECT id, COALESCE(NULLIF(display_name, ''), email) AS name, avatar_media_id, chips AS value FROM user WHERE ${BOTS}`;
    const params = [];
    if (friendIds) { sql += ` AND id IN (${friendIds.map(() => "?").join(",")})`; params.push(...friendIds); }
    sql += " ORDER BY chips DESC, name ASC LIMIT ?"; params.push(limit);
    const rows = await query(sql, params);
    return rows.map((r) => ({ id: r.id, name: r.name, avatarMediaId: r.avatar_media_id || null, value: Number(r.value) }));
  }

  // net winnings over the window
  const since = windowStart(timeframe);
  let sql =
    "SELECT php.user_id AS id, COALESCE(NULLIF(u.display_name, ''), u.email) AS name, u.avatar_media_id, SUM(php.net) AS value "
    + "FROM poker_hand_player php "
    + "JOIN poker_hand ph ON ph.id = php.hand_id "
    + "JOIN user u ON u.id = php.user_id "
    + `WHERE u.${BOTS} AND ph.ended_at >= ?`;
  const params = [since];
  if (friendIds) { sql += ` AND php.user_id IN (${friendIds.map(() => "?").join(",")})`; params.push(...friendIds); }
  sql += " GROUP BY php.user_id, name, u.avatar_media_id HAVING value <> 0 ORDER BY value DESC LIMIT ?"; params.push(limit);
  const rows = await query(sql, params);
  return rows.map((r) => ({ id: r.id, name: r.name, avatarMediaId: r.avatar_media_id || null, value: Number(r.value) }));
}
