// Bank money-path smoke test — the guarantees from the escrow review. LOCAL
// dev DB only. Verifies:
//   [1] buyIn debits + writes escrow atomically; cashOut is escrow-authoritative
//       (credits exactly the escrow stack) and idempotent (a 2nd cashOut of the
//       same seat credits nothing — no double-pay on a retried Stand);
//   [2] rebuy adds to the SAME user's escrow (owner-guarded);
//   [3] cashOut credits the ESCROW value, not the original buy-in (models a win
//       snapshotted by syncStacks);
//   [4] cashOut with a wrong expected owner is rejected, row untouched;
//   [5] a fresh buyIn can't overwrite an existing seat's escrow (no debit).
//
//   node scripts/smoke-bank.js

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

const { execute, query, closePool, tx, getPool } = await import("../src/lib/server/db.js");
const { getBalance, applyDelta, balanceForOpKey, REASON } = await import("../src/lib/server/wallet.js");
const { buyIn, rebuy, cashOut, syncStacks, acquireInstanceLease, releaseInstanceLease, hasInstanceLease } =
  await import("../src/lib/server/poker/bank.js");
const { createTableRow, closeTableRow } = await import("../src/lib/server/poker/store.js");

const uid = (n) => `smokebank-${n}-${randomBytes(4).toString("hex")}`;
async function mkUser(id, chips) {
  await execute(
    "INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at, chips) VALUES (?,?,?,?,0,?,?)",
    [id, `${id}@ex.test`, "x", id, Date.now(), chips]
  );
}
const escrowStack = async (tid, seat) => {
  const r = await query("SELECT stack FROM poker_escrow WHERE table_id = ? AND seat_no = ?", [tid, seat]);
  return r.length ? Number(r[0].stack) : null;
};

const U0 = uid("a"), U1 = uid("b");
await mkUser(U0, 10_000);
await mkUser(U1, 10_000);
const tid = await createTableRow(
  { name: "Bank Smoke", maxSeats: 6, smallBlind: 1, bigBlind: 2, minBuyin: 40, maxBuyin: 5000 }, U0
);

try {
  // [1] buyIn + escrow-authoritative + idempotent cashOut
  await buyIn(U0, 100, tid, 0);
  assert.equal(await getBalance(U0), 9_900, "buyIn debited");
  assert.equal(await escrowStack(tid, 0), 100, "escrow written on buyIn");

  // [2] rebuy adds to the same escrow row
  await rebuy(U0, 50, tid, 0);
  assert.equal(await getBalance(U0), 9_850, "rebuy debited");
  assert.equal(await escrowStack(tid, 0), 150, "rebuy added to escrow");

  // [3] cashOut credits the ESCROW value (simulate a win of +70 via syncStacks)
  await syncStacks(tid, [{ userId: U0, seatNo: 0, stack: 220 }]);
  const r1 = await cashOut(tid, 0, U0);
  assert.equal(r1.refunded, 220, "cashOut refunds the escrow value, not the buy-in");
  assert.equal(await getBalance(U0), 9_850 + 220, "wallet credited by escrow value");
  assert.equal(await escrowStack(tid, 0), null, "escrow row deleted");

  // [1b] idempotent — a retried Stand credits nothing
  const before = await getBalance(U0);
  const r2 = await cashOut(tid, 0, U0);
  assert.equal(r2.refunded, 0, "second cashOut refunds nothing");
  assert.equal(await getBalance(U0), before, "no double credit on retry");
  console.log("  [1] escrow-authoritative + idempotent cashOut + rebuy OK");

  // [4] owner mismatch is rejected, row untouched
  await buyIn(U1, 80, tid, 1);
  let threw = false;
  try { await cashOut(tid, 1, U0); } catch (e) { threw = e.code === "ESCROW_OWNER_MISMATCH"; }
  assert.ok(threw, "cashOut rejects a wrong expected owner");
  assert.equal(await escrowStack(tid, 1), 80, "escrow intact after rejected cashOut");
  const okOwner = await cashOut(tid, 1, U1);
  assert.equal(okOwner.refunded, 80, "correct owner cashes out");
  console.log("  [2] owner-mismatch rejection OK");

  // [5] a fresh buyIn can't overwrite an existing seat's escrow, and a failed
  // buyIn does not debit (tx rollback on the duplicate-key INSERT).
  await buyIn(U0, 100, tid, 2);
  const balBefore = await getBalance(U0);
  let dupThrew = false;
  try { await buyIn(U1, 300, tid, 2); } catch { dupThrew = true; }
  assert.ok(dupThrew, "duplicate seat buyIn throws");
  assert.equal(await escrowStack(tid, 2), 100, "existing escrow not overwritten");
  assert.equal(await getBalance(U1), 10_000, "failed buyIn did not debit (rollback)");
  assert.equal(await getBalance(U0), balBefore, "incumbent unaffected");
  await cashOut(tid, 2, U0); // cleanup this seat
  console.log("  [3] no-overwrite + no-debit-on-failed-buyIn OK");

  // [6] idempotency key (#2): the SAME op_key can't apply a delta twice, and the
  // committed outcome is resolvable — this is what makes a lost-COMMIT-ack retry
  // exactly-once (bank.runIdempotent).
  const KEY = "smoke-op-" + randomBytes(6).toString("hex");
  const balBeforeKey = await getBalance(U0);
  const applied = await tx((conn) => applyDelta(conn, U0, -100, REASON.TABLE_BUYIN, tid, KEY));
  assert.equal(applied, balBeforeKey - 100, "first apply of op_key debited");
  assert.equal(await balanceForOpKey(KEY), balBeforeKey - 100, "op_key resolvable to its committed balance");
  let dupThrew2 = false;
  try { await tx((conn) => applyDelta(conn, U0, -100, REASON.TABLE_BUYIN, tid, KEY)); }
  catch { dupThrew2 = true; }
  assert.ok(dupThrew2, "re-applying the same op_key throws (UNIQUE)");
  assert.equal(await getBalance(U0), balBeforeKey - 100, "no double-debit on the duplicate op_key");
  assert.equal(await balanceForOpKey("nope-" + KEY), null, "unknown op_key resolves to null");
  console.log("  [4] op_key idempotency OK");

  // [7] single-instance lease (#4): only one holder at a time. If a live poker
  // instance (e.g. a running `npm run dev`) already holds the lease, that IS the
  // mutual exclusion working — skip rather than fail.
  const held = await acquireInstanceLease();
  if (!held) {
    console.log("  [5] single-instance lease SKIPPED — lease held elsewhere (a dev/prod poker instance is running)");
  } else {
    assert.ok(hasInstanceLease(), "acquired the instance lease");
    const pool = await getPool();
    const other = await pool.getConnection();
    try {
      const [[r]] = await other.query("SELECT GET_LOCK('riverside_poker_singleton', 0) AS ok");
      assert.equal(Number(r.ok), 0, "a second connection cannot acquire the lease while held");
    } finally {
      other.release();
    }
    await releaseInstanceLease();
    assert.ok(!hasInstanceLease(), "lease released");
    const other2 = await pool.getConnection();
    try {
      const [[r]] = await other2.query("SELECT GET_LOCK('riverside_poker_singleton', 0) AS ok");
      assert.equal(Number(r.ok), 1, "lease acquirable again after release");
      await other2.query("SELECT RELEASE_LOCK('riverside_poker_singleton')");
    } finally {
      other2.release();
    }
    console.log("  [5] single-instance lease OK");
  }

  // [8] request-boundary op-keys (#2): a client-supplied opId reused across a
  // resend dedupes at the bank layer — no double-charge, no memory divergence.
  const CK = "client-" + randomBytes(8).toString("hex");
  const b0 = await getBalance(U0);
  await buyIn(U0, 100, tid, 3, CK);            // first sit
  const b1 = await getBalance(U0);
  assert.equal(b1, b0 - 100, "client-key buyIn debited once");
  await buyIn(U0, 100, tid, 3, CK);            // resend with the SAME client opId
  assert.equal(await getBalance(U0), b1, "sit resend did NOT double-charge");
  assert.equal(await escrowStack(tid, 3), 100, "escrow not doubled by the resend");

  const RK = "client-" + randomBytes(8).toString("hex");
  const r0 = await getBalance(U0);
  const rr1 = await rebuy(U0, 50, tid, 3, RK);
  assert.equal(rr1.stack, 150, "rebuy returns the authoritative stack");
  assert.equal(await getBalance(U0), r0 - 50, "client-key rebuy debited once");
  const rr2 = await rebuy(U0, 50, tid, 3, RK); // resend with the SAME client opId
  assert.equal(await getBalance(U0), r0 - 50, "rebuy resend did NOT double-charge");
  assert.equal(rr2.stack, 150, "rebuy resend returns the same authoritative stack");
  assert.equal(await escrowStack(tid, 3), 150, "escrow stack unchanged by the resend");
  await cashOut(tid, 3, U0); // cleanup
  console.log("  [6] request-boundary op-keys (sit/rebuy resend) OK");

  console.log("[smoke-bank] ALL OK");
} finally {
  await execute("DELETE FROM poker_escrow WHERE table_id = ?", [tid]).catch(() => {});
  try { await closeTableRow(tid); } catch { /* noop */ }
  await execute("DELETE FROM poker_hand WHERE table_id = ?", [tid]).catch(() => {});
  await execute("DELETE FROM poker_table WHERE id = ?", [tid]).catch(() => {});
  for (const id of [U0, U1]) await execute("DELETE FROM user WHERE id = ?", [id]).catch(() => {});
  await closePool();
  process.exit(0);
}
