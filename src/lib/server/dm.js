// Private 1:1 messages between friends. Persistence + queries live here; the
// friendship gate and live WS delivery live in the hub. DB access is injectable
// ({ query, execute }) so the logic is unit-tested without MySQL.

import { randomBytes } from "node:crypto";
import * as realDb from "./db.js";

const MAX_LEN = 2000;

// Both directions of one conversation share a stable key (sorted pair), so a
// thread is a single indexed range scan.
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function newId() {
  return randomBytes(16).toString("hex");
}

// Persist a message. Returns the stored row (or null if the body is empty). The
// caller has already checked that from/to are friends.
export async function sendMessage(fromId, toId, text, db = realDb) {
  const body = String(text || "").trim().slice(0, MAX_LEN);
  if (!body || !fromId || !toId || fromId === toId) return null;
  const row = {
    id: newId(), pairKey: pairKey(fromId, toId),
    fromUserId: fromId, toUserId: toId, body, createdAt: Date.now()
  };
  await db.execute(
    "INSERT INTO dm_message (id, pair_key, from_user_id, to_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [row.id, row.pairKey, row.fromUserId, row.toUserId, row.body, row.createdAt]
  );
  return row;
}

// The most recent messages of a conversation, oldest-first for rendering.
export async function thread(a, b, limit = 100, db = realDb) {
  const rows = await db.query(
    "SELECT id, from_user_id, to_user_id, body, created_at, read_at FROM dm_message "
    + "WHERE pair_key = ? ORDER BY seq DESC LIMIT ?",
    [pairKey(a, b), limit]
  );
  return rows
    .map((r) => ({
      id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id,
      body: r.body, createdAt: Number(r.created_at), readAt: r.read_at ? Number(r.read_at) : null
    }))
    .reverse();
}

// Mark every message the OTHER user sent to `userId` as read (opening the thread).
export async function markRead(userId, otherId, db = realDb) {
  await db.execute(
    "UPDATE dm_message SET read_at = ? WHERE pair_key = ? AND to_user_id = ? AND read_at IS NULL",
    [Date.now(), pairKey(userId, otherId), userId]
  );
}

// How many unread messages `userId` has, total and per sender (for badges).
export async function unreadCounts(userId, db = realDb) {
  const rows = await db.query(
    "SELECT from_user_id, COUNT(*) AS n FROM dm_message "
    + "WHERE to_user_id = ? AND read_at IS NULL GROUP BY from_user_id",
    [userId]
  );
  const byUser = new Map(rows.map((r) => [r.from_user_id, Number(r.n)]));
  let total = 0;
  for (const n of byUser.values()) total += n;
  return { total, byUser };
}
