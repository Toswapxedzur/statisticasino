// Crash-recovery smoke test for the escrow ledger. Runs against the LOCAL
// dev DB only. Proves the invariant that a HARD crash (no graceful drain)
// can't destroy chips:
//   1. seat a player -> wallet debited, escrow row written (atomically);
//   2. simulate a crash by dropping in-memory hub state WITHOUT draining
//      (escrow rows survive in the DB);
//   3. reconcileEscrowOnBoot() refunds every escrow row to its wallet and
//      closes stale ephemeral tables;
//   4. re-running reconcile is idempotent (no double-refund).
//
//   node scripts/smoke-escrow.js

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

const { execute, query, closePool } = await import("../src/lib/server/db.js");
const { hub } = await import("../src/lib/server/poker/hub.js");
const { getBalance } = await import("../src/lib/server/wallet.js");
const { reconcileEscrowOnBoot } = await import("../src/lib/server/poker/bank.js");
const { C2S, S2C, encode } = await import("../src/lib/poker/protocol.js");

const uid = (n) => `smokeesc-${n}-${randomBytes(4).toString("hex")}`;
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
const last = (c, t) => [...c.frames].reverse().find((f) => f.t === t);
const escrowRows = (userId) =>
  query("SELECT table_id, seat_no, stack FROM poker_escrow WHERE user_id = ?", [userId]);

const U = uid("u");
await mkUser(U, 10_000);
const cleanupIds = [U];

try {
  const c = conn(U, "Crasher");
  hub.addConnection(c);

  // 1) Sit via createTable (buy-in 200). Wallet debited, escrow written.
  hub.handleMessage(c, encode(C2S.TABLE_CREATE,
    { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 200 }));
  await new Promise((r) => setTimeout(r, 50)); // let the async create settle
  const tid = last(c, S2C.TABLE_CREATED)?.tableId;
  assert.ok(tid, "table created");

  const balAfterSit = await getBalance(U);
  assert.equal(balAfterSit, 9_800, "wallet debited by the buy-in");
  const rows1 = await escrowRows(U);
  assert.equal(rows1.length, 1, "one escrow row for the seated player");
  assert.equal(Number(rows1[0].stack), 200, "escrow stack == buy-in");
  assert.equal(rows1[0].table_id, tid, "escrow points at the right table");
  console.log(`  [1] sit -> wallet ${balAfterSit}, escrow stack ${rows1[0].stack} OK`);

  // 2) Simulate a HARD crash: drop all in-memory state WITHOUT draining, so
  // the escrow rows are all that remain of those chips.
  for (const t of hub.tables.values()) {
    t.clearActionTimer?.();
    t.clearStartTimer?.();
    for (const s of t.seats.values()) t.clearVacateTimer?.(s);
  }
  hub.tables.clear();
  hub.connections.clear();
  const rowsAfterCrash = await escrowRows(U);
  assert.equal(rowsAfterCrash.length, 1, "escrow survives the crash");
  console.log("  [2] crash (memory dropped, escrow persists) OK");

  // 3) Boot reconciliation refunds escrow -> wallet.
  const summary = await reconcileEscrowOnBoot();
  assert.ok(summary.seats >= 1, "reconcile processed at least our seat");
  const balAfterBoot = await getBalance(U);
  assert.equal(balAfterBoot, 10_000, "player made whole after reconcile (chip conservation)");
  const rows2 = await escrowRows(U);
  assert.equal(rows2.length, 0, "escrow row cleared after refund");
  const tblRow = await query("SELECT is_active FROM poker_table WHERE id = ?", [tid]);
  assert.equal(Number(tblRow[0]?.is_active), 0, "stale ephemeral table marked closed");
  console.log(`  [3] reconcile -> wallet ${balAfterBoot}, escrow cleared, table closed OK`);

  // 4) Idempotent: a second reconcile must not double-refund.
  await reconcileEscrowOnBoot();
  const balAfterSecond = await getBalance(U);
  assert.equal(balAfterSecond, 10_000, "second reconcile did not double-credit");
  console.log("  [4] reconcile idempotent OK");

  console.log("[smoke-escrow] ALL OK");
} finally {
  for (const t of hub.tables.values()) { t.clearActionTimer?.(); t.clearStartTimer?.(); }
  await execute("DELETE FROM poker_escrow WHERE user_id = ?", [U]).catch(() => {});
  for (const id of cleanupIds) await execute("DELETE FROM user WHERE id = ?", [id]).catch(() => {});
  await closePool();
  process.exit(0);
}
