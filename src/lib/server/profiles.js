// Public player profiles: identity (name, avatar, bio, status), game stats, and
// the viewer's relationship to the subject. Respects the per-user
// `profile_visibility` setting (public | friends | private). Read-only queries;
// profile edits go through the account page's form actions.

import { query, queryOne } from "./db.js";
import { areFriends } from "./friends.js";

// The viewer's relationship to the subject: 'self' | 'friends' | 'incoming'
// (they requested me) | 'outgoing' (I requested them) | 'none'.
async function relationship(viewerId, userId) {
  if (!viewerId) return "none";
  if (viewerId === userId) return "self";
  const rows = await query(
    "SELECT requester_id, status FROM friendship "
    + "WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?) LIMIT 1",
    [viewerId, userId, userId, viewerId]
  );
  if (!rows.length) return "none";
  const r = rows[0];
  if (r.status === "accepted") return "friends";
  return r.requester_id === viewerId ? "outgoing" : "incoming";
}

async function gameStats(userId) {
  const s = await queryOne(
    "SELECT COUNT(*) AS hands, COALESCE(SUM(net),0) AS net, COALESCE(MAX(net),0) AS best "
    + "FROM poker_hand_player WHERE user_id = ?",
    [userId]
  );
  const a = await queryOne("SELECT COUNT(*) AS n FROM user_achievement WHERE user_id = ?", [userId]);
  return {
    handsPlayed: Number(s?.hands || 0),
    netGame: Number(s?.net || 0),
    biggestPot: Number(s?.best || 0),
    achievements: Number(a?.n || 0),
  };
}

// Full profile for `userId` as seen by `viewerId`. Returns null if no such user.
export async function getProfile(userId, viewerId = null) {
  const u = await queryOne(
    "SELECT id, display_name, email, created_at, bio, status_text, avatar_media_id, "
    + "profile_visibility, daily_streak, best_streak, chips FROM user WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!u) return null;

  const rel = await relationship(viewerId, userId);
  const isSelf = rel === "self";
  const visibility = u.profile_visibility || "public";
  const canSeeDetail = isSelf || visibility === "public" || (visibility === "friends" && rel === "friends");

  const base = {
    id: u.id,
    name: u.display_name || u.email,
    avatarMediaId: u.avatar_media_id || null,
    memberSince: Number(u.created_at),
    relationship: rel,
    isSelf,
    visibility,
    canSeeDetail,
  };
  if (!canSeeDetail) return { ...base, restricted: true };

  return {
    ...base,
    bio: u.bio || null,
    statusText: u.status_text || null,
    streak: Number(u.daily_streak || 0),
    bestStreak: Number(u.best_streak || 0),
    chips: Number(u.chips || 0),
    stats: await gameStats(userId),
  };
}

// Lightweight identity for lists (chat headers, seat plates): id, name, avatar.
export async function identities(userIds) {
  const uniq = [...new Set((userIds || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await query(
    `SELECT id, display_name, email, avatar_media_id FROM user WHERE id IN (${uniq.map(() => "?").join(",")})`,
    uniq
  );
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.display_name || r.email, avatarMediaId: r.avatar_media_id || null }]));
}

// Update a user's editable profile fields. Only whitelisted keys are written.
export async function updateProfile(userId, fields) {
  const sets = [];
  const vals = [];
  if (typeof fields.bio === "string") { sets.push("bio = ?"); vals.push(fields.bio.slice(0, 500)); }
  if (typeof fields.statusText === "string") { sets.push("status_text = ?"); vals.push(fields.statusText.slice(0, 140)); }
  if (typeof fields.visibility === "string" && ["public", "friends", "private"].includes(fields.visibility)) {
    sets.push("profile_visibility = ?"); vals.push(fields.visibility);
  }
  if (typeof fields.avatarMediaId === "string" || fields.avatarMediaId === null) {
    sets.push("avatar_media_id = ?"); vals.push(fields.avatarMediaId);
  }
  if (!sets.length) return;
  vals.push(userId);
  const { execute } = await import("./db.js");
  await execute(`UPDATE user SET ${sets.join(", ")} WHERE id = ?`, vals);
}
