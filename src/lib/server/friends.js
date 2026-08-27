// The friend graph. A `friendship` row is directed by who asked
// (requester → addressee) but undirected once accepted. All DB access goes
// through an injectable `db` ({ query, execute }) so the graph logic is unit-
// tested without MySQL.

import * as realDb from "./db.js";

// Send a friend request from `fromId` to `toId`. If `toId` had already asked
// `fromId`, this ACCEPTS that pending request instead of creating a mirror row.
// Returns { status: 'self' | 'exists' | 'accepted' | 'pending' }.
export async function requestFriend(fromId, toId, db = realDb) {
  if (!fromId || !toId || fromId === toId) return { status: "self" };
  const existing = await db.query(
    "SELECT requester_id, addressee_id, status FROM friendship "
    + "WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
    [fromId, toId, toId, fromId]
  );
  const now = Date.now();
  for (const r of existing) {
    if (r.status === "accepted") return { status: "exists" };
    if (r.requester_id === toId) {
      // They already requested us → accept it.
      await db.execute(
        "UPDATE friendship SET status = 'accepted', responded_at = ? WHERE requester_id = ? AND addressee_id = ?",
        [now, toId, fromId]
      );
      return { status: "accepted" };
    }
    return { status: "exists" }; // our own request is already pending
  }
  // Enforce the target's friend-request policy (default 'everyone').
  const pol = await db.query("SELECT friend_req_policy FROM user WHERE id = ?", [toId]);
  const policy = pol[0]?.friend_req_policy || "everyone";
  if (policy === "nobody") return { status: "blocked" };
  if (policy === "fof") {
    const mutual = await db.query(
      "SELECT 1 FROM "
      + "(SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid FROM friendship WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)) a "
      + "JOIN "
      + "(SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid FROM friendship WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)) b "
      + "ON a.fid = b.fid LIMIT 1",
      [fromId, fromId, fromId, toId, toId, toId]
    );
    if (!mutual.length) return { status: "blocked_fof" };
  }

  await db.execute(
    "INSERT INTO friendship (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
    [fromId, toId, now]
  );
  return { status: "pending" };
}

// `userId` (the addressee) accepts or declines `requesterId`'s pending request.
// Returns true if a pending request was actually acted on.
export async function respondFriend(userId, requesterId, accept, db = realDb) {
  if (accept) {
    const res = await db.execute(
      "UPDATE friendship SET status = 'accepted', responded_at = ? "
      + "WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
      [Date.now(), requesterId, userId]
    );
    return (res.affectedRows ?? 0) > 0;
  }
  const res = await db.execute(
    "DELETE FROM friendship WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
    [requesterId, userId]
  );
  return (res.affectedRows ?? 0) > 0;
}

// Remove a friendship (or cancel an outgoing request) in either direction.
export async function removeFriend(userId, otherId, db = realDb) {
  const res = await db.execute(
    "DELETE FROM friendship WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
    [userId, otherId, otherId, userId]
  );
  return (res.affectedRows ?? 0) > 0;
}

// Partition a user's edges into accepted friends, incoming requests (to answer),
// and outgoing requests (awaiting the other side). Returns id lists; the caller
// resolves names + presence.
export async function listFriends(userId, db = realDb) {
  const rows = await db.query(
    "SELECT requester_id, addressee_id, status FROM friendship WHERE requester_id = ? OR addressee_id = ?",
    [userId, userId]
  );
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    const other = r.requester_id === userId ? r.addressee_id : r.requester_id;
    if (r.status === "accepted") friends.push(other);
    else if (r.addressee_id === userId) incoming.push(r.requester_id);
    else outgoing.push(r.addressee_id);
  }
  return { friends, incoming, outgoing };
}

// True if the two users are accepted friends (used to gate DMs/voice later).
export async function areFriends(a, b, db = realDb) {
  if (!a || !b || a === b) return false;
  const rows = await db.query(
    "SELECT 1 FROM friendship WHERE status = 'accepted' AND "
    + "((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) LIMIT 1",
    [a, b, b, a]
  );
  return rows.length > 0;
}
