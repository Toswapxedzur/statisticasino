// Conversation model: DM get-or-create idempotency, group creation, posting +
// ordering, per-member unread accounting, and read tracking — all against an
// in-memory fake of the { query, execute } DB surface (no MySQL).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dmKey, getOrCreateDm, createGroup, postMessage, getMessages,
  listConversations, unreadTotal, markRead, isMember, memberIds,
} from "./conversations.js";

// ---- tiny in-memory DB emulating the SQL we actually issue ------------------
function makeDb() {
  const conv = new Map();      // id -> row
  const mem = [];              // { conv_id, user_id, role, joined_at, last_read_seq }
  const msg = [];              // { id, seq, conv_id, sender_id, kind, body, media_id, reply_to, created_at, ... }
  let seq = 0;

  const memRow = (cid, uid) => mem.find((m) => m.conv_id === cid && m.user_id === uid);

  async function execute(sql, p = []) {
    if (sql.includes("INSERT INTO conversation ")) {
      // columns vary (dm vs group); map by the VALUES order we pass.
      if (sql.includes("'dm'")) {
        const [id, dm_key, created_by, created_at, last_msg_at] = p;
        conv.set(id, { id, kind: "dm", title: null, avatar_media_id: null, dm_key, created_by, created_at, last_msg_at });
      } else {
        const [id, title, created_by, created_at, last_msg_at] = p;
        conv.set(id, { id, kind: "group", title, avatar_media_id: null, dm_key: null, created_by, created_at, last_msg_at });
      }
      return { affectedRows: 1 };
    }
    if (sql.includes("INSERT IGNORE INTO conversation_member") || sql.includes("INSERT INTO conversation_member") || (sql.includes("conversation_member") && sql.startsWith("INSERT"))) {
      // one or two rows depending on the VALUES tuples
      for (let i = 0; i < p.length; i += 3) {
        const [cid, uid, role] = [p[i], p[i + 1], p[i + 2]];
        // the joined_at is folded into the tuple order (cid,uid,role? or cid,uid,role,joined)
        if (!memRow(cid, uid)) mem.push({ conv_id: cid, user_id: uid, role: role === "owner" || role === "member" || role === "admin" ? role : "member", joined_at: Date.now(), last_read_seq: 0 });
      }
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT INTO chat_message")) {
      const [id, conv_id, sender_id, kind, body, media_id, reply_to, created_at] = p;
      seq += 1;
      msg.push({ id, seq, conv_id, sender_id, kind, body, media_id, reply_to, created_at, edited_at: null, deleted_at: null });
      return { insertId: seq, affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE conversation SET last_msg_at")) {
      const [ts, id] = p; if (conv.get(id)) conv.get(id).last_msg_at = ts; return { affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE conversation_member SET last_read_seq")) {
      const [s, cid, uid] = p; const m = memRow(cid, uid); if (m && m.last_read_seq < s) m.last_read_seq = s; return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  async function query(sql, p = []) {
    if (sql.includes("FROM conversation WHERE dm_key")) {
      const key = p[0]; const c = [...conv.values()].find((x) => x.dm_key === key); return c ? [{ id: c.id }] : [];
    }
    if (sql.includes("SELECT 1 FROM conversation_member")) {
      const [cid, uid] = p; return memRow(cid, uid) ? [{ "1": 1 }] : [];
    }
    if (sql.includes("SELECT user_id FROM conversation_member")) {
      const cid = p[0]; return mem.filter((m) => m.conv_id === cid).map((m) => ({ user_id: m.user_id }));
    }
    if (sql.includes("SELECT user_id, role, joined_at FROM conversation_member")) {
      const cid = p[0]; return mem.filter((m) => m.conv_id === cid).map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at }));
    }
    if (sql.includes("SELECT MAX(seq) AS m FROM chat_message")) {
      const cid = p[0]; const rows = msg.filter((m) => m.conv_id === cid); return [{ m: rows.length ? Math.max(...rows.map((r) => r.seq)) : null }];
    }
    if (sql.includes("ORDER BY seq DESC LIMIT 1")) {
      const cid = p[0]; const rows = msg.filter((m) => m.conv_id === cid).sort((a, b) => b.seq - a.seq).slice(0, 1); return rows;
    }
    if (sql.includes("FROM chat_message WHERE conv_id = ? ORDER BY seq DESC LIMIT")) {
      const [cid] = p; return msg.filter((m) => m.conv_id === cid).sort((a, b) => b.seq - a.seq);
    }
    if (sql.includes("COUNT(*) AS n FROM chat_message WHERE conv_id = ? AND seq >")) {
      const [cid, lastRead, uid] = p; const n = msg.filter((m) => m.conv_id === cid && m.seq > lastRead && m.sender_id !== uid).length; return [{ n }];
    }
    if (sql.includes("FROM conversation c JOIN conversation_member cm")) {
      const uid = p[0];
      const mine = mem.filter((m) => m.user_id === uid).map((m) => ({ c: conv.get(m.conv_id), lr: m.last_read_seq })).filter((x) => x.c);
      mine.sort((a, b) => (b.c.last_msg_at || 0) - (a.c.last_msg_at || 0));
      return mine.map(({ c, lr }) => ({ id: c.id, kind: c.kind, title: c.title, avatar_media_id: null, dm_key: c.dm_key, created_by: c.created_by, last_msg_at: c.last_msg_at, last_read_seq: lr }));
    }
    if (sql.includes("COALESCE(SUM(n),0) AS total")) {
      const uid = p[0]; let total = 0;
      for (const m of mem.filter((x) => x.user_id === uid)) total += msg.filter((x) => x.conv_id === m.conv_id && x.seq > m.last_read_seq && x.sender_id !== uid).length;
      return [{ total }];
    }
    return [];
  }
  return { query, execute, _conv: conv, _mem: mem, _msg: msg };
}

test("dmKey is order-independent", () => {
  assert.equal(dmKey("a", "b"), dmKey("b", "a"));
});

test("getOrCreateDm is idempotent and seats both members", async () => {
  const db = makeDb();
  const id1 = await getOrCreateDm("a", "b", db);
  const id2 = await getOrCreateDm("b", "a", db);
  assert.equal(id1, id2, "same conversation regardless of order");
  assert.ok(await isMember(id1, "a", db));
  assert.ok(await isMember(id1, "b", db));
  assert.deepEqual((await memberIds(id1, db)).sort(), ["a", "b"]);
});

test("posting orders by seq and drives unread per member", async () => {
  const db = makeDb();
  const c = await getOrCreateDm("a", "b", db);
  await postMessage(c, "a", { body: "hi" }, db);
  await postMessage(c, "a", { body: "you there?" }, db);
  const msgs = await getMessages(c, 100, db);
  assert.deepEqual(msgs.map((m) => m.body), ["hi", "you there?"], "oldest-first");

  // b has two unread (from a); a has zero (own messages auto-read).
  assert.equal(await unreadTotal("b", db), 2);
  assert.equal(await unreadTotal("a", db), 0);

  await markRead(c, "b", null, db);
  assert.equal(await unreadTotal("b", db), 0, "reading clears unread");
});

test("group creation seats members and lists for each", async () => {
  const db = makeDb();
  const g = await createGroup("a", "Poker crew", ["b", "c"], db);
  assert.deepEqual((await memberIds(g, db)).sort(), ["a", "b", "c"]);
  await postMessage(g, "a", { body: "gg" }, db);
  const forB = await listConversations("b", db);
  assert.equal(forB.length, 1);
  assert.equal(forB[0].kind, "group");
  assert.equal(forB[0].title, "Poker crew");
  assert.equal(forB[0].unread, 1);
  assert.equal(forB[0].last.body, "gg");
});
