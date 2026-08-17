// Concurrency + lifecycle smoke test for the hub hardening pass. Runs against
// the LOCAL dev DB only, with fake in-memory connections. Verifies:
//   [1] per-user lock — two simultaneous quick-plays from one user land at a
//       single table with a single buy-in (no double-seat / double-debit);
//   [2] invite sweep — expired invites are proactively dropped;
//   [3] shutdown drain — hub.shutdown() refunds every seat to its wallet and
//       clears all tables (chip conservation across a graceful restart).
//
//   node scripts/smoke-hub-concurrency.js

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!/localhost|127\.0\.0\.1/.test(process.env.MYSQL_HOST || "")) {
  console.error("REFUSING: not a local DB."); process.exit(1);
}

const { execute, closePool } = await import("../src/lib/server/db.js");
const { hub } = await import("../src/lib/server/poker/hub.js");
const { getBalance } = await import("../src/lib/server/wallet.js");
const { C2S } = await import("../src/lib/poker/protocol.js");

const uid = (n) => `smokecc-${n}-${randomBytes(4).toString("hex")}`;
async function mkUser(id, chips) {
  await execute(
    "INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at, chips) VALUES (?,?,?,?,0,?,?)",
    [id, `${id}@ex.test`, "x", id, Date.now(), chips]
  );
}
function conn(id, name) {
  return {
    user: { id, email: `${id}@ex.test`, displayName: name, isAdmin: false },
    watching: new Set(), frames: [],
    send(d) { this.frames.push(typeof d === "string" ? JSON.parse(d) : d); }
  };
}
const tablesSeating = (userId) =>
  [...hub.tables.values()].filter((t) => t.seatForUser(userId));

const A = uid("a"), B = uid("b");
await mkUser(A, 10000);
await mkUser(B, 10000);
const cleanupIds = [A, B];

try {
  // ---- [1] per-user lock: two tabs quick-play at once ----
  const a1 = conn(A, "Alice-tab1");
  const a2 = conn(A, "Alice-tab2");
  hub.addConnection(a1);
  hub.addConnection(a2);

  const startBal = await getBalance(A);
  // Fire both concurrently — the classic double-tab race.
  await Promise.all([hub.quickPlay(a1, {}), hub.quickPlay(a2, {})]);

  const seatedTables = tablesSeating(A);
  assert.equal(seatedTables.length, 1, `user seated at exactly one table (got ${seatedTables.length})`);
  const seat = seatedTables[0].seatForUser(A);
  const afterBal = await getBalance(A);
  assert.equal(startBal - afterBal, seat.stack, "exactly one buy-in debited (no double-charge)");
  console.log(`  [1] per-user lock OK (1 table, buy-in ${seat.stack}, no double-seat)`);

  // ---- [2] invite sweep ----
  hub.invites.set("expired-x", { fromUserId: A, toUserId: B, tableId: "t", expiresAt: Date.now() - 1 });
  hub.invites.set("live-x", { fromUserId: A, toUserId: B, tableId: "t", expiresAt: Date.now() + 60_000 });
  hub._sweepInvites();
  assert.ok(!hub.invites.has("expired-x"), "expired invite swept");
  assert.ok(hub.invites.has("live-x"), "live invite retained");
  hub.invites.delete("live-x");
  console.log("  [2] invite sweep OK");

  // ---- [3] shutdown drain ----
  const onTable = seat.stack;
  await hub.shutdown();
  assert.equal(hub.tables.size, 0, "all tables dropped on shutdown");
  const drainedBal = await getBalance(A);
  assert.equal(drainedBal, afterBal + onTable, "seat refunded to wallet on drain");
  assert.equal(drainedBal, 10000, "user made whole (chip conservation)");
  console.log("  [3] shutdown drain OK");

  console.log("[smoke-hub-concurrency] ALL OK");
} finally {
  for (const t of hub.tables.values()) { t.clearActionTimer?.(); t.clearStartTimer?.(); }
  for (const id of cleanupIds) await execute("DELETE FROM user WHERE id = ?", [id]).catch(() => {});
  await closePool();
  process.exit(0);
}
