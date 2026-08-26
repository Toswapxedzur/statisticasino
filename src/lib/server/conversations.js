// Unified conversations: a conversation is a 1:1 DM (kind='dm', two members,
// `dm_key` = sorted pair) or a group (kind='group', N members). One code path
// serves both DM and group messaging. The friendship gate for DMs and live WS
// fan-out live in the hub; persistence + queries live here. DB access is
// injectable ({ query, execute }) so the logic is unit-tested without MySQL.

import { randomBytes } from "node:crypto";
import * as realDb from "./db.js";

const MAX_LEN = 4000;
const newId = () => randomBytes(16).toString("hex");

// Sorted pair key so a DM between two users is unique regardless of direction.
export function dmKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Find (or create) the 1:1 conversation between two users. Idempotent via the
// UNIQUE dm_key. Returns the conversation id.
export async function getOrCreateDm(a, b, db = realDb) {
  if (!a || !b || a === b) return null;
  const key = dmKey(a, b);
  const existing = await db.query("SELECT id FROM conversation WHERE dm_key = ? LIMIT 1", [key]);
  if (existing.length) return existing[0].id;

  const id = newId();
  const now = Date.now();
  try {
    await db.execute(
      "INSERT INTO conversation (id, kind, dm_key, created_by, created_at, last_msg_at) VALUES (?, 'dm', ?, ?, ?, ?)",
      [id, key, a, now, now]
    );
  } catch (e) {
    // Lost a create race — the other insert won; return the existing row.
    const again = await db.query("SELECT id FROM conversation WHERE dm_key = ? LIMIT 1", [key]);
    if (again.length) return again[0].id;
    throw e;
  }
  await db.execute(
    "INSERT IGNORE INTO conversation_member (conv_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?), (?, ?, 'member', ?)",
    [id, a, now, id, b, now]
  );
  return id;
}

// Create a group with an initial member set (creator is owner). Returns the id.
export async function createGroup(creatorId, title, memberIds = [], db = realDb) {
  if (!creatorId) return null;
  const id = newId();
  const now = Date.now();
  const name = String(title || "New group").trim().slice(0, 128) || "New group";
  await db.execute(
    "INSERT INTO conversation (id, kind, title, created_by, created_at, last_msg_at) VALUES (?, 'group', ?, ?, ?, ?)",
    [id, name, creatorId, now, now]
  );
  const ids = [...new Set([creatorId, ...memberIds])].filter(Boolean);
  for (const uid of ids) {
    await db.execute(
      "INSERT IGNORE INTO conversation_member (conv_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
      [id, uid, uid === creatorId ? "owner" : "member", now]
    );
  }
  return id;
}

export async function isMember(convId, userId, db = realDb) {
  if (!convId || !userId) return false;
  const rows = await db.query(
    "SELECT 1 FROM conversation_member WHERE conv_id = ? AND user_id = ? LIMIT 1",
    [convId, userId]
  );
  return rows.length > 0;
}

export async function memberIds(convId, db = realDb) {
  const rows = await db.query("SELECT user_id FROM conversation_member WHERE conv_id = ?", [convId]);
  return rows.map((r) => r.user_id);
}

export async function members(convId, db = realDb) {
  const rows = await db.query(
    "SELECT user_id, role, joined_at FROM conversation_member WHERE conv_id = ? ORDER BY joined_at ASC",
    [convId]
  );
  return rows.map((r) => ({ userId: r.user_id, role: r.role, joinedAt: Number(r.joined_at) }));
}

// Load a conversation header (id, kind, title, avatar, members, createdBy).
export async function getConversation(convId, db = realDb) {
  const rows = await db.query(
    "SELECT id, kind, title, avatar_media_id, dm_key, created_by, created_at, last_msg_at FROM conversation WHERE id = ? LIMIT 1",
    [convId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, kind: r.kind, title: r.title, avatarMediaId: r.avatar_media_id,
    dmKey: r.dm_key, createdBy: r.created_by,
    createdAt: Number(r.created_at), lastMsgAt: r.last_msg_at ? Number(r.last_msg_at) : null,
    members: await members(convId, db),
  };
}

// Persist a message. `sender` must already be a validated member (or null for a
// system message). Returns the stored row incl. its assigned `seq`.
export async function postMessage(convId, senderId, opts = {}, db = realDb) {
  const kind = opts.kind || "text";
  const body = opts.body != null ? String(opts.body).trim().slice(0, MAX_LEN) : null;
  if (kind === "text" && !body) return null;
  const id = newId();
  const now = Date.now();
  const res = await db.execute(
    "INSERT INTO chat_message (id, conv_id, sender_id, kind, body, media_id, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, convId, senderId ?? null, kind, body, opts.mediaId ?? null, opts.replyTo ?? null, now]
  );
  const seq = res && res.insertId ? Number(res.insertId) : null;
  await db.execute("UPDATE conversation SET last_msg_at = ? WHERE id = ?", [now, convId]);
  // Sender has implicitly read their own message.
  if (senderId && seq != null) {
    await db.execute(
      "UPDATE conversation_member SET last_read_seq = ? WHERE conv_id = ? AND user_id = ? AND last_read_seq < ?",
      [seq, convId, senderId, seq]
    );
  }
  return {
    id, seq, convId, senderId: senderId ?? null, kind, body,
    mediaId: opts.mediaId ?? null, replyTo: opts.replyTo ?? null, createdAt: now,
  };
}

// Most recent messages of a conversation, oldest-first for rendering.
export async function getMessages(convId, limit = 100, db = realDb) {
  const rows = await db.query(
    "SELECT id, seq, sender_id, kind, body, media_id, reply_to, created_at, edited_at, deleted_at "
    + "FROM chat_message WHERE conv_id = ? ORDER BY seq DESC LIMIT ?",
    [convId, limit]
  );
  return rows
    .map((r) => ({
      id: r.id, seq: Number(r.seq), senderId: r.sender_id, kind: r.kind,
      body: r.deleted_at ? null : r.body, mediaId: r.media_id, replyTo: r.reply_to,
      createdAt: Number(r.created_at),
      editedAt: r.edited_at ? Number(r.edited_at) : null,
      deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
    }))
    .reverse();
}

// Soft-delete a message (only its own sender may). Returns true if it deleted.
export async function deleteMessage(convId, messageId, userId, db = realDb) {
  const res = await db.execute(
    "UPDATE chat_message SET deleted_at = ?, body = NULL, media_id = NULL WHERE id = ? AND conv_id = ? AND sender_id = ? AND deleted_at IS NULL",
    [Date.now(), messageId, convId, userId]
  );
  return (res.affectedRows ?? 0) > 0;
}

// The highest seq a member has read (for read receipts).
export async function readState(convId, db = realDb) {
  const rows = await db.query("SELECT user_id, last_read_seq FROM conversation_member WHERE conv_id = ?", [convId]);
  return rows.map((r) => ({ userId: r.user_id, seq: Number(r.last_read_seq) }));
}

// Mark everything up to `uptoSeq` (or the newest) read for one member.
export async function markRead(convId, userId, uptoSeq = null, db = realDb) {
  let seq = uptoSeq;
  if (seq == null) {
    const rows = await db.query("SELECT MAX(seq) AS m FROM chat_message WHERE conv_id = ?", [convId]);
    seq = rows.length && rows[0].m != null ? Number(rows[0].m) : 0;
  }
  await db.execute(
    "UPDATE conversation_member SET last_read_seq = ? WHERE conv_id = ? AND user_id = ? AND last_read_seq < ?",
    [seq, convId, userId, seq]
  );
}

// Every conversation `userId` belongs to, newest activity first, each with its
// last message, unread count, and member ids. One list drives the chat pane.
export async function listConversations(userId, db = realDb) {
  const convs = await db.query(
    "SELECT c.id, c.kind, c.title, c.avatar_media_id, c.dm_key, c.created_by, c.last_msg_at, cm.last_read_seq "
    + "FROM conversation c JOIN conversation_member cm ON cm.conv_id = c.id "
    + "WHERE cm.user_id = ? ORDER BY c.last_msg_at DESC",
    [userId]
  );
  const out = [];
  for (const c of convs) {
    const lastRows = await db.query(
      "SELECT id, seq, sender_id, kind, body, media_id, created_at, deleted_at FROM chat_message "
      + "WHERE conv_id = ? ORDER BY seq DESC LIMIT 1",
      [c.id]
    );
    const last = lastRows[0]
      ? {
          id: lastRows[0].id, seq: Number(lastRows[0].seq), senderId: lastRows[0].sender_id,
          kind: lastRows[0].kind, body: lastRows[0].deleted_at ? null : lastRows[0].body,
          mediaId: lastRows[0].media_id, createdAt: Number(lastRows[0].created_at),
        }
      : null;
    const unreadRows = await db.query(
      "SELECT COUNT(*) AS n FROM chat_message WHERE conv_id = ? AND seq > ? AND (sender_id IS NULL OR sender_id <> ?)",
      [c.id, Number(c.last_read_seq), userId]
    );
    out.push({
      id: c.id, kind: c.kind, title: c.title, avatarMediaId: c.avatar_media_id,
      dmKey: c.dm_key, createdBy: c.created_by,
      lastMsgAt: c.last_msg_at ? Number(c.last_msg_at) : null,
      members: await memberIds(c.id, db),
      last, unread: Number(unreadRows[0]?.n || 0),
    });
  }
  return out;
}

// Total unread across all of a user's conversations (for the nav badge).
export async function unreadTotal(userId, db = realDb) {
  const rows = await db.query(
    "SELECT COALESCE(SUM(n),0) AS total FROM ("
    + "  SELECT COUNT(*) AS n FROM conversation_member cm "
    + "  JOIN chat_message m ON m.conv_id = cm.conv_id AND m.seq > cm.last_read_seq "
    + "    AND (m.sender_id IS NULL OR m.sender_id <> cm.user_id) "
    + "  WHERE cm.user_id = ? GROUP BY cm.conv_id"
    + ") t",
    [userId]
  );
  return Number(rows[0]?.total || 0);
}

// ---- group management -------------------------------------------------------

export async function addMembers(convId, userIds = [], db = realDb) {
  const now = Date.now();
  for (const uid of userIds.filter(Boolean)) {
    await db.execute(
      "INSERT IGNORE INTO conversation_member (conv_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      [convId, uid, now]
    );
  }
}

export async function removeMember(convId, userId, db = realDb) {
  await db.execute("DELETE FROM conversation_member WHERE conv_id = ? AND user_id = ?", [convId, userId]);
}

export async function setRole(convId, userId, role, db = realDb) {
  await db.execute("UPDATE conversation_member SET role = ? WHERE conv_id = ? AND user_id = ?", [role, convId, userId]);
}

export async function rename(convId, title, db = realDb) {
  await db.execute("UPDATE conversation SET title = ? WHERE id = ? AND kind = 'group'",
    [String(title || "").trim().slice(0, 128), convId]);
}

export async function setAvatar(convId, mediaId, db = realDb) {
  await db.execute("UPDATE conversation SET avatar_media_id = ? WHERE id = ?", [mediaId, convId]);
}

export async function roleOf(convId, userId, db = realDb) {
  const rows = await db.query("SELECT role FROM conversation_member WHERE conv_id = ? AND user_id = ? LIMIT 1", [convId, userId]);
  return rows.length ? rows[0].role : null;
}
