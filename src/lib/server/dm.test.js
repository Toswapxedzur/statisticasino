// Friend DMs: pair-key symmetry, send/thread ordering, read-marking, and unread
// counts — against an in-memory db mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pairKey, sendMessage, thread, markRead, unreadCounts } from "./dm.js";

function makeDb() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async execute(sql, p) {
      if (sql.startsWith("INSERT")) {
        const [id, pair_key, from_user_id, to_user_id, body, created_at] = p;
        rows.push({ id, seq: ++seq, pair_key, from_user_id, to_user_id, body, created_at, read_at: null });
        return { affectedRows: 1 };
      }
      // UPDATE ... SET read_at = ? WHERE pair_key = ? AND to_user_id = ? AND read_at IS NULL
      const [readAt, pk, to] = p;
      let n = 0;
      for (const r of rows) if (r.pair_key === pk && r.to_user_id === to && r.read_at == null) { r.read_at = readAt; n++; }
      return { affectedRows: n };
    },
    async query(sql, p) {
      if (sql.includes("GROUP BY from_user_id")) {
        const [to] = p;
        const counts = new Map();
        for (const r of rows) if (r.to_user_id === to && r.read_at == null) counts.set(r.from_user_id, (counts.get(r.from_user_id) || 0) + 1);
        return [...counts].map(([from_user_id, n]) => ({ from_user_id, n }));
      }
      // thread: WHERE pair_key = ? ORDER BY seq DESC LIMIT ?
      const [pk, limit] = p;
      return rows.filter((r) => r.pair_key === pk).sort((a, b) => b.seq - a.seq).slice(0, limit);
    }
  };
}

test("pairKey is symmetric", () => {
  assert.equal(pairKey("a", "b"), pairKey("b", "a"));
  assert.equal(pairKey("b", "a"), "a|b");
});

test("empty / self messages are rejected", async () => {
  const db = makeDb();
  assert.equal(await sendMessage("a", "b", "   ", db), null);
  assert.equal(await sendMessage("a", "a", "hi", db), null);
  assert.equal(db.rows.length, 0);
});

test("a thread returns both directions oldest-first", async () => {
  const db = makeDb();
  await sendMessage("a", "b", "hey", db);
  await sendMessage("b", "a", "yo", db);
  await sendMessage("a", "b", "wanna play?", db);
  const t = await thread("b", "a", 100, db);
  assert.deepEqual(t.map((m) => m.body), ["hey", "yo", "wanna play?"]);
  assert.equal(t[0].fromUserId, "a");
});

test("markRead clears only the reader's incoming unread; counts reflect it", async () => {
  const db = makeDb();
  await sendMessage("a", "b", "1", db);
  await sendMessage("a", "b", "2", db);
  await sendMessage("b", "a", "3", db);
  // b has 2 unread from a; a has 1 unread from b.
  assert.equal((await unreadCounts("b", db)).total, 2);
  assert.equal((await unreadCounts("a", db)).total, 1);
  await markRead("b", "a", db); // b opens the thread
  assert.equal((await unreadCounts("b", db)).total, 0);
  assert.equal((await unreadCounts("a", db)).total, 1, "a's unread is untouched");
});
