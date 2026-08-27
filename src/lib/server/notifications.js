// In-app notifications — the activity feed behind the topbar bell. Rows are
// created for friend requests/accepts, chip transfers, and missed messages, and
// gated at creation by the recipient's notify* preferences (user.settings JSON).
//
// Persistence + queries live here; live WS delivery (S2C.NOTIFY) lives in the
// hub, which calls createNotification() then pushes the returned row. DB access
// is injectable ({ query, queryOne, execute }) so the logic is unit-tested
// without MySQL.

import { randomBytes } from "node:crypto";
import * as realDb from "./db.js";
import { parseSocialSettings } from "./social-settings.js";

function newId() {
  return randomBytes(16).toString("hex");
}

// Which preference flag gates each notification kind. A kind absent from the map
// is always allowed (no gate).
const KIND_PREF = {
  friend_request: "notifyFriendReq",
  friend_accept: "notifyFriendReq",
  transfer: "notifyTransfers",
  message: "notifyMessages",
};

// Has this user enabled notifications of the given kind?
async function wantsKind(userId, kind, db) {
  const pref = KIND_PREF[kind];
  if (!pref) return true;
  const row = await db.queryOne("SELECT settings FROM user WHERE id = ?", [userId]);
  return !!parseSocialSettings(row?.settings)[pref];
}

// Create a notification for `userId`. Returns the stored row, or null if the
// recipient has that kind turned off (nothing is persisted then). `message`
// notifications coalesce per conversation: a fresh one for the same (user, ref)
// replaces any earlier UNREAD message notification so the bell shows one entry
// per chat, not one per message.
export async function createNotification(userId, kind, { actorId = null, ref = null, body } = {}, db = realDb) {
  if (!userId || !kind || !body) return null;
  if (!(await wantsKind(userId, kind, db))) return null;

  if (kind === "message" && ref) {
    await db.execute(
      "DELETE FROM notification WHERE user_id = ? AND kind = 'message' AND ref = ? AND read_at IS NULL",
      [userId, ref]
    );
  }

  const id = newId();
  const createdAt = Date.now();
  const text = String(body).slice(0, 255);
  await db.execute(
    "INSERT INTO notification (id, user_id, kind, actor_id, ref, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, userId, kind, actorId, ref, text, createdAt]
  );
  const back = await db.queryOne("SELECT seq FROM notification WHERE id = ?", [id]);
  return {
    id,
    seq: back?.seq ?? 0,
    userId,
    kind,
    actorId,
    ref,
    body: text,
    createdAt,
    readAt: null,
  };
}

// Most-recent notifications first (newest seq). Shape matches createNotification.
export async function listNotifications(userId, limit = 30, db = realDb) {
  if (!userId) return [];
  const n = Math.max(1, Math.min(100, limit | 0 || 30));
  const rows = await db.query(
    "SELECT id, seq, kind, actor_id, ref, body, created_at, read_at "
    + "FROM notification WHERE user_id = ? ORDER BY seq DESC LIMIT ?",
    [userId, n]
  );
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    userId,
    kind: r.kind,
    actorId: r.actor_id,
    ref: r.ref,
    body: r.body,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

export async function unreadCount(userId, db = realDb) {
  if (!userId) return 0;
  const row = await db.queryOne(
    "SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL",
    [userId]
  );
  return Number(row?.n || 0);
}

// Mark notifications read. Pass { all: true } to clear everything, or { ids: [...] }
// to clear specific rows. Returns the number of rows newly marked read.
export async function markRead(userId, { all = false, ids = null } = {}, db = realDb) {
  if (!userId) return 0;
  const now = Date.now();
  if (all) {
    const res = await db.execute(
      "UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
      [now, userId]
    );
    return res?.affectedRows ?? 0;
  }
  if (Array.isArray(ids) && ids.length) {
    const marks = ids.map(() => "?").join(",");
    const res = await db.execute(
      `UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${marks})`,
      [now, userId, ...ids]
    );
    return res?.affectedRows ?? 0;
  }
  return 0;
}
