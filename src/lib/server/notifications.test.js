// Notifications: pref gating, message coalescing, listing order, unread count,
// and mark-read — against an in-memory db mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotification, listNotifications, unreadCount, markRead } from "./notifications.js";

function makeDb(settingsByUser = {}) {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async queryOne(sql, p) {
      if (sql.includes("FROM user")) {
        const [uid] = p;
        return { settings: settingsByUser[uid] ?? null };
      }
      if (sql.includes("SELECT seq FROM notification")) {
        const [id] = p;
        const r = rows.find((x) => x.id === id);
        return r ? { seq: r.seq } : null;
      }
      if (sql.includes("COUNT(*)")) {
        const [uid] = p;
        return { n: rows.filter((r) => r.user_id === uid && r.read_at == null).length };
      }
      return null;
    },
    async execute(sql, p) {
      if (sql.startsWith("DELETE")) {
        const [uid, ref] = p;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.user_id === uid && r.kind === "message" && r.ref === ref && r.read_at == null) rows.splice(i, 1);
        }
        return { affectedRows: 1 };
      }
      if (sql.startsWith("INSERT")) {
        const [id, user_id, kind, actor_id, ref, body, created_at] = p;
        rows.push({ id, seq: ++seq, user_id, kind, actor_id, ref, body, created_at, read_at: null });
        return { affectedRows: 1 };
      }
      // UPDATE ... SET read_at = ? WHERE user_id = ? AND read_at IS NULL [AND id IN (...)]
      const now = p[0];
      const uid = p[1];
      const ids = p.slice(2);
      let n = 0;
      for (const r of rows) {
        if (r.user_id !== uid || r.read_at != null) continue;
        if (ids.length && !ids.includes(r.id)) continue;
        r.read_at = now; n++;
      }
      return { affectedRows: n };
    },
    async query(sql, p) {
      const [uid, limit] = p;
      return rows
        .filter((r) => r.user_id === uid)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
        .map((r) => ({
          id: r.id, seq: r.seq, kind: r.kind, actor_id: r.actor_id,
          ref: r.ref, body: r.body, created_at: r.created_at, read_at: r.read_at,
        }));
    },
  };
}

test("createNotification stores a row and returns it", async () => {
  const db = makeDb();
  const n = await createNotification("u1", "friend_request", { actorId: "u2", body: "X sent you a friend request" }, db);
  assert.equal(n.kind, "friend_request");
  assert.equal(n.actorId, "u2");
  assert.equal(n.readAt, null);
  assert.equal(db.rows.length, 1);
});

test("createNotification is suppressed when the recipient disabled that kind", async () => {
  const db = makeDb({ u1: JSON.stringify({ notifyFriendReq: false }) });
  const n = await createNotification("u1", "friend_request", { actorId: "u2", body: "hi" }, db);
  assert.equal(n, null);
  assert.equal(db.rows.length, 0);
});

test("disabling one kind does not suppress another", async () => {
  const db = makeDb({ u1: JSON.stringify({ notifyMessages: false }) });
  assert.equal(await createNotification("u1", "message", { ref: "c1", body: "hey" }, db), null);
  const t = await createNotification("u1", "transfer", { actorId: "u2", body: "got chips" }, db);
  assert.ok(t);
  assert.equal(db.rows.length, 1);
});

test("message notifications coalesce per conversation", async () => {
  const db = makeDb();
  await createNotification("u1", "message", { actorId: "u2", ref: "c1", body: "A: one" }, db);
  await createNotification("u1", "message", { actorId: "u2", ref: "c1", body: "A: two" }, db);
  const msgs = db.rows.filter((r) => r.kind === "message" && r.ref === "c1");
  assert.equal(msgs.length, 1);            // only the latest survives
  assert.equal(msgs[0].body, "A: two");
});

test("a different conversation gets its own message notification", async () => {
  const db = makeDb();
  await createNotification("u1", "message", { ref: "c1", body: "A: one" }, db);
  await createNotification("u1", "message", { ref: "c2", body: "B: hi" }, db);
  assert.equal(db.rows.filter((r) => r.kind === "message").length, 2);
});

test("listNotifications returns newest first", async () => {
  const db = makeDb();
  await createNotification("u1", "friend_request", { body: "1" }, db);
  await createNotification("u1", "transfer", { body: "2" }, db);
  const list = await listNotifications("u1", 10, db);
  assert.deepEqual(list.map((n) => n.body), ["2", "1"]);
});

test("unreadCount and markRead", async () => {
  const db = makeDb();
  await createNotification("u1", "friend_request", { body: "1" }, db);
  await createNotification("u1", "transfer", { body: "2" }, db);
  assert.equal(await unreadCount("u1", db), 2);
  const one = db.rows[0].id;
  assert.equal(await markRead("u1", { ids: [one] }, db), 1);
  assert.equal(await unreadCount("u1", db), 1);
  assert.equal(await markRead("u1", { all: true }, db), 1);
  assert.equal(await unreadCount("u1", db), 0);
});

test("markRead ignores another user's rows", async () => {
  const db = makeDb();
  await createNotification("u1", "transfer", { body: "mine" }, db);
  await createNotification("u2", "transfer", { body: "theirs" }, db);
  assert.equal(await markRead("u1", { all: true }, db), 1);
  assert.equal(await unreadCount("u2", db), 1);
});

test("body is required and capped at 255 chars", async () => {
  const db = makeDb();
  assert.equal(await createNotification("u1", "transfer", { body: "" }, db), null);
  const long = "x".repeat(400);
  const n = await createNotification("u1", "transfer", { body: long }, db);
  assert.equal(n.body.length, 255);
});
