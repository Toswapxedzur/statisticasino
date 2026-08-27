// Live friend-finding: trigram search (typo-tolerant, ranked) + recommendations
// (recent teammates from hand history, then friends-of-friends) shown before the
// user has typed enough to search.
import { query } from "./db.js";
import { trigrams } from "./trigram.js";

const BOTS = "u.email NOT LIKE '%@bot.riverside.invalid'";

// Rank users by how many trigrams they share with the query. Excludes bots + self.
export async function searchByTrigram(q, limit = 12, excludeId = null) {
  const grams = trigrams(q);
  if (!grams.length) return [];
  const gph = grams.map(() => "?").join(",");
  const params = [...grams];
  let sql =
    "SELECT t.user_id AS id, u.display_name, u.email, u.avatar_media_id, COUNT(*) AS score "
    + "FROM user_trigram t JOIN user u ON u.id = t.user_id "
    + `WHERE t.gram IN (${gph}) AND ${BOTS} `;
  if (excludeId) { sql += "AND t.user_id <> ? "; params.push(excludeId); }
  sql += "GROUP BY t.user_id, u.display_name, u.email, u.avatar_media_id "
    + "ORDER BY score DESC, u.display_name ASC LIMIT ?";
  params.push(limit);
  const rows = await query(sql, params);
  return rows.map((r) => ({ id: r.id, name: r.display_name || r.email, avatarMediaId: r.avatar_media_id || null, score: Number(r.score) }));
}

// Ids of `userId`'s accepted friends.
async function friendIdsOf(userId) {
  const rows = await query(
    "SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid "
    + "FROM friendship WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)",
    [userId, userId, userId]
  );
  return rows.map((r) => r.fid);
}

// Ids the user already has any friendship edge with (accepted OR pending) — never
// recommend these.
async function connectedIdsOf(userId) {
  const rows = await query(
    "SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid "
    + "FROM friendship WHERE requester_id = ? OR addressee_id = ?",
    [userId, userId, userId]
  );
  return new Set(rows.map((r) => r.fid));
}

// Recommendations for the Find tab: recent teammates first, then friends-of-friends.
export async function recommendFriends(userId, limit = 12) {
  const excluded = await connectedIdsOf(userId);
  excluded.add(userId);

  // Recent teammates — co-players sharing my hands, ranked by shared-hand count.
  const teammates = await query(
    `SELECT p2.user_id AS id, u.display_name, u.email, u.avatar_media_id, COUNT(*) AS shared
       FROM poker_hand_player p1
       JOIN poker_hand_player p2 ON p2.hand_id = p1.hand_id AND p2.user_id <> p1.user_id
       JOIN user u ON u.id = p2.user_id
      WHERE p1.user_id = ? AND ${BOTS}
      GROUP BY p2.user_id, u.display_name, u.email, u.avatar_media_id
      ORDER BY shared DESC
      LIMIT 40`,
    [userId]
  );
  const out = [];
  const seen = new Set(excluded);
  for (const r of teammates) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.display_name || r.email, avatarMediaId: r.avatar_media_id || null, reason: `Played ${r.shared} hand${r.shared > 1 ? "s" : ""} together` });
    if (out.length >= limit) return out;
  }

  // Friends-of-friends.
  const friendIds = await friendIdsOf(userId);
  if (friendIds.length) {
    const ph = friendIds.map(() => "?").join(",");
    const edges = await query(
      `SELECT requester_id AS a, addressee_id AS b FROM friendship
        WHERE status = 'accepted' AND (requester_id IN (${ph}) OR addressee_id IN (${ph}))`,
      [...friendIds, ...friendIds]
    );
    const fSet = new Set(friendIds);
    const cand = new Set();
    for (const e of edges) {
      if (fSet.has(e.a) && !seen.has(e.b)) cand.add(e.b);
      if (fSet.has(e.b) && !seen.has(e.a)) cand.add(e.a);
    }
    const ids = [...cand].slice(0, limit - out.length);
    if (ids.length) {
      const uph = ids.map(() => "?").join(",");
      const users = await query(
        `SELECT id, display_name, email, avatar_media_id FROM user WHERE id IN (${uph}) AND ${BOTS}`,
        ids
      );
      for (const u of users) out.push({ id: u.id, name: u.display_name || u.email, avatarMediaId: u.avatar_media_id || null, reason: "Friend of a friend" });
    }
  }
  return out.slice(0, limit);
}
