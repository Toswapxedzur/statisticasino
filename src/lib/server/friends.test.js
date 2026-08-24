// The friend graph: requests, reciprocal auto-accept, accept/decline, removal,
// and the friends/incoming/outgoing partition — against an in-memory db mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { requestFriend, respondFriend, removeFriend, listFriends, areFriends } from "./friends.js";

// Mock of db.js's { query, execute } over an array of friendship rows. Only the
// three SQL shapes friends.js uses are recognized (by keyword sniffing).
function makeDb() {
  let rows = []; // { requester_id, addressee_id, status, created_at, responded_at }
  const pairMatch = (r, a, b) => r.requester_id === a && r.addressee_id === b;
  return {
    rows: () => rows,
    async query(sql, p) {
      if (sql.includes("status = 'accepted' AND")) { // areFriends
        const [a, b] = p;
        return rows.filter((r) => r.status === "accepted" && (pairMatch(r, a, b) || pairMatch(r, b, a))).slice(0, 1).map(() => ({ 1: 1 }));
      }
      if (sql.includes("OR addressee_id = ?")) { // listFriends
        const [uid] = p;
        return rows.filter((r) => r.requester_id === uid || r.addressee_id === uid);
      }
      // requestFriend existence check: both directions
      const [a, b, c, d] = p;
      return rows.filter((r) => pairMatch(r, a, b) || pairMatch(r, c, d));
    },
    async execute(sql, p) {
      if (sql.startsWith("INSERT")) {
        const [requester_id, addressee_id, created_at] = p;
        rows.push({ requester_id, addressee_id, status: "pending", created_at, responded_at: null });
        return { affectedRows: 1 };
      }
      if (sql.startsWith("UPDATE")) {
        // accept: [now, requester, addressee]
        const [now, requester, addressee] = p;
        let n = 0;
        for (const r of rows) if (pairMatch(r, requester, addressee) && r.status === "pending") { r.status = "accepted"; r.responded_at = now; n++; }
        return { affectedRows: n };
      }
      // DELETE
      const before = rows.length;
      if (sql.includes("status = 'pending'")) {
        const [requester, addressee] = p;
        rows = rows.filter((r) => !(pairMatch(r, requester, addressee) && r.status === "pending"));
      } else {
        const [a, b, c, d] = p;
        rows = rows.filter((r) => !(pairMatch(r, a, b) || pairMatch(r, c, d)));
      }
      return { affectedRows: before - rows.length };
    }
  };
}

test("a request is pending, then the addressee sees it incoming", async () => {
  const db = makeDb();
  assert.deepEqual(await requestFriend("a", "b", db), { status: "pending" });
  assert.deepEqual(await listFriends("b", db), { friends: [], incoming: ["a"], outgoing: [] });
  assert.deepEqual(await listFriends("a", db), { friends: [], incoming: [], outgoing: ["b"] });
  assert.equal(await areFriends("a", "b", db), false);
});

test("you can't friend yourself; a duplicate request is a no-op", async () => {
  const db = makeDb();
  assert.deepEqual(await requestFriend("a", "a", db), { status: "self" });
  await requestFriend("a", "b", db);
  assert.deepEqual(await requestFriend("a", "b", db), { status: "exists" });
});

test("a reciprocal request auto-accepts instead of making a mirror row", async () => {
  const db = makeDb();
  await requestFriend("a", "b", db);
  assert.deepEqual(await requestFriend("b", "a", db), { status: "accepted" });
  assert.equal(await areFriends("a", "b", db), true);
  assert.deepEqual((await listFriends("a", db)).friends, ["b"]);
  assert.deepEqual((await listFriends("b", db)).friends, ["a"]);
});

test("accept turns a pending request into a friendship; decline drops it", async () => {
  const db = makeDb();
  await requestFriend("a", "b", db);
  assert.equal(await respondFriend("b", "a", true, db), true);
  assert.equal(await areFriends("a", "b", db), true);

  const db2 = makeDb();
  await requestFriend("a", "b", db2);
  assert.equal(await respondFriend("b", "a", false, db2), true); // decline
  assert.equal(await areFriends("a", "b", db2), false);
  assert.deepEqual(await listFriends("b", db2), { friends: [], incoming: [], outgoing: [] });
});

test("remove deletes the edge in either direction", async () => {
  const db = makeDb();
  await requestFriend("a", "b", db);
  await respondFriend("b", "a", true, db);
  assert.equal(await removeFriend("b", "a", db), true); // remover is the addressee
  assert.equal(await areFriends("a", "b", db), false);
});
