// Bank — the chip custody layer for live tables. Bridges the wallet
// (durable, ledger-backed) and the `poker_escrow` table (durable mirror of
// chips currently held in an in-memory seat stack).
//
// Why this exists: a buy-in debits the wallet, and the resulting stack lives
// only in a LiveTable in memory. If the process dies uncleanly those chips
// would vanish. Escrow makes the custody durable. The invariant is
//     sum(wallet balances) + sum(escrow stacks) = constant
// at every COMMITTED db state, and it's preserved by two rules:
//   * every buy-in/rebuy writes the wallet debit AND the escrow row in ONE tx;
//   * CASH-OUT IS ESCROW-AUTHORITATIVE — it credits EXACTLY the amount stored
//     in the escrow row (read + locked FOR UPDATE), then deletes that row, in
//     one tx. It never credits a caller-supplied amount. If the row is already
//     gone it credits nothing. That makes cash-out conserve chips regardless
//     of any in-memory drift, AND idempotent (a retried Stand after a
//     committed-but-unacked cash-out finds no row and credits nothing).
//
// On boot, reconcileEscrowOnBoot() returns every row to its wallet.
//
// LiveTable talks to this module through its injected `wallet` dependency
// (so tests can swap an escrow-aware in-memory fake): buyIn / rebuy / cashOut
// / syncStacks. Plain-node-ESM clean so it runs under prod server.js + Vite.

import { randomBytes } from "node:crypto";
import { tx, getPool } from "../db.js";
import { applyDelta, REASON, balanceForOpKey } from "../wallet.js";

function newOpKey() {
  return randomBytes(16).toString("hex");
}

// Run a money operation exactly-once under a lost COMMIT acknowledgement. If
// `fn` throws, we can't tell locally whether the transaction committed (the
// ack may have been dropped after COMMIT) — so we look the op_key up in the
// ledger: present ⇒ it durably committed (the wallet delta AND its escrow write,
// which live in the same tx), so return that balance instead of re-applying or
// surfacing a spurious failure; absent ⇒ it never committed, so rethrow.
async function runIdempotent(opKey, fn) {
  try {
    return await fn();
  } catch (err) {
    let committed = null;
    try { committed = await balanceForOpKey(opKey); } catch { /* can't resolve now */ }
    if (committed != null) return committed;
    throw err;
  }
}

// Fresh sit: debit `amount` from the wallet AND create this seat's escrow row,
// atomically. A plain INSERT (not an upsert) so a committed-but-unacked prior
// buy-in can't be silently overwritten by a different user landing on the same
// seat number — a duplicate key surfaces as an error the caller treats as a
// failed sit (the orphan escrow is refunded at the next boot reconcile).
// Returns the new wallet balance.
export async function buyIn(userId, amount, tableId, seatNo) {
  const opKey = newOpKey();
  return runIdempotent(opKey, () => tx(async (conn) => {
    const balance = await applyDelta(conn, userId, -amount, REASON.TABLE_BUYIN, tableId, opKey);
    await conn.execute(
      `INSERT INTO poker_escrow (table_id, seat_no, user_id, stack, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tableId, seatNo, userId, amount, Date.now()]
    );
    return balance;
  }));
}

// Rebuy: debit `amount` and add it to THIS user's existing escrow row,
// atomically. The UPDATE is guarded on user_id so it can never touch another
// occupant's row; affectedRows 0 (seat gone / not ours) throws and rolls the
// debit back. Returns the new wallet balance.
export async function rebuy(userId, amount, tableId, seatNo) {
  const opKey = newOpKey();
  return runIdempotent(opKey, () => tx(async (conn) => {
    const balance = await applyDelta(conn, userId, -amount, REASON.TABLE_BUYIN, tableId, opKey);
    const [res] = await conn.execute(
      `UPDATE poker_escrow SET stack = stack + ?, updated_at = ?
       WHERE table_id = ? AND seat_no = ? AND user_id = ?`,
      [amount, Date.now(), tableId, seatNo, userId]
    );
    if ((res.affectedRows ?? 0) === 0) {
      const e = new Error("escrow row missing for rebuy");
      e.code = "ESCROW_MISSING";
      throw e; // rolls back the debit
    }
    return balance;
  }));
}

// Cash-out: ESCROW-AUTHORITATIVE + idempotent. Lock the seat's escrow row; if
// it's gone, credit nothing (already cashed out). Otherwise credit EXACTLY the
// escrow stack and delete the row, in one tx — so wallet+escrow is conserved by
// construction. `expectUserId`, when given, asserts the row's owner (a mismatch
// throws rather than paying the wrong account). Returns { balance, refunded }.
export async function cashOut(tableId, seatNo, expectUserId = null) {
  return tx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT user_id, stack FROM poker_escrow WHERE table_id = ? AND seat_no = ? FOR UPDATE",
      [tableId, seatNo]
    );
    if (!rows.length) {
      // Nothing escrowed here — already cashed out. Report the current balance.
      let balance = 0;
      if (expectUserId) {
        const [b] = await conn.query("SELECT chips FROM user WHERE id = ?", [expectUserId]);
        balance = b.length ? Number(b[0].chips) : 0;
      }
      return { balance, refunded: 0 };
    }
    const owner = rows[0].user_id;
    if (expectUserId && owner !== expectUserId) {
      const e = new Error("escrow owner mismatch");
      e.code = "ESCROW_OWNER_MISMATCH";
      throw e;
    }
    const amount = Number(rows[0].stack);
    let balance;
    if (amount > 0) {
      balance = await applyDelta(conn, owner, amount, REASON.TABLE_CASHOUT, tableId);
    } else {
      const [b] = await conn.query("SELECT chips FROM user WHERE id = ?", [owner]);
      balance = b.length ? Number(b[0].chips) : 0;
    }
    await conn.execute(
      "DELETE FROM poker_escrow WHERE table_id = ? AND seat_no = ?",
      [tableId, seatNo]
    );
    return { balance, refunded: amount };
  });
}

// Snapshot post-hand stacks into escrow (no wallet movement) so a crash refunds
// actual results, not pre-hand amounts. Each UPDATE is guarded on user_id so it
// can't clobber a seat that changed hands. Callers retry on failure; because
// cash-out is escrow-authoritative, a stale snapshot never breaks conservation
// (only refund fairness), so this stays best-effort at the call site.
export async function syncStacks(tableId, seats) {
  if (!seats || seats.length === 0) return;
  const now = Date.now();
  return tx(async (conn) => {
    for (const s of seats) {
      await conn.execute(
        `UPDATE poker_escrow SET stack = ?, updated_at = ?
         WHERE table_id = ? AND seat_no = ? AND user_id = ?`,
        [s.stack, now, tableId, s.seatNo, s.userId]
      );
    }
  });
}

// Boot reconciliation: refund every persisted escrow row to its wallet and
// clear it, then close ephemeral table rows still marked active (their
// in-memory instances are gone after a restart).
//
// Safety:
//   * A process-lifetime advisory lock (GET_LOCK) guarantees only ONE process
//     reconciles at a time, so a rolling deploy or a dev server sharing the DB
//     can't refund chips that belong to another LIVE instance. If the lock is
//     held elsewhere we skip entirely.
//   * Each row is refunded+deleted in its OWN transaction, re-read+locked FOR
//     UPDATE (both user_id and stack), so a mid-loop crash is idempotent and a
//     concurrent change can't pay the wrong account.
//   * Per-row failures are retried; the summary reports anything left behind so
//     the caller can decide (server.js logs loudly; it never fails open
//     silently). Tables are only closed if EVERY row reconciled.
export async function reconcileEscrowOnBoot() {
  const pool = await getPool();
  // Do ALL work on this ONE dedicated connection — the advisory lock is
  // connection-scoped, and running the per-row transactions here too means
  // reconciliation never waits on a second pool connection (so it can't
  // deadlock against itself when MYSQL_POOL_LIMIT=1).
  const conn = await pool.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('riverside_escrow_reconcile', 0) AS ok");
    if (Number(lock.ok) !== 1) {
      return { skipped: true, reason: "another process holds the reconcile lock", seats: 0, chips: 0, failed: 0 };
    }
    try {
      const [rows] = await conn.query("SELECT table_id, seat_no FROM poker_escrow");
      let seats = 0;
      let chips = 0;
      let failed = 0;
      for (const r of rows) {
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
          try {
            await conn.beginTransaction();
            const [ex] = await conn.query(
              "SELECT user_id, stack FROM poker_escrow WHERE table_id = ? AND seat_no = ? FOR UPDATE",
              [r.table_id, r.seat_no]
            );
            let amt = 0;
            if (ex.length) {
              amt = Number(ex[0].stack);
              if (amt > 0) {
                await applyDelta(conn, ex[0].user_id, amt, REASON.ESCROW_REFUND, r.table_id);
              }
              await conn.execute(
                "DELETE FROM poker_escrow WHERE table_id = ? AND seat_no = ?",
                [r.table_id, r.seat_no]
              );
            }
            await conn.commit();
            seats += 1;
            chips += amt;
            done = true;
          } catch (err) {
            try { await conn.rollback(); } catch { /* swallow */ }
            if (attempt === 2) failed += 1; // give up on this row for now
          }
        }
      }
      // Only reclaim tables once escrow is fully drained, so a stranded row is
      // never orphaned behind a closed table.
      if (failed === 0) {
        await conn.execute(
          "UPDATE poker_table SET is_active = 0, closed_at = ? WHERE is_ephemeral = 1 AND is_active = 1",
          [Date.now()]
        );
      }
      return { skipped: false, seats, chips, failed };
    } finally {
      await conn.query("SELECT RELEASE_LOCK('riverside_escrow_reconcile')");
    }
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------- single-instance lease

// A process-lifetime advisory lock so only ONE poker server manages escrow for
// a given database at a time. Without it, a second live process (a rolling
// deploy, or a dev server pointed at the same DB) could reconcile — and refund
// — escrow that the first process still holds live, double-paying it. The lock
// lives on a dedicated connection held for the whole process; MySQL drops it
// automatically if that connection dies.
let _leaseConn = null;
let _leaseReleasing = false; // true during an intentional release (not a fault)

// Try to become the sole poker instance. Returns true if we now hold the lease
// (caller may reconcile + serve poker), false if another live process holds it
// (caller must NOT reconcile and should serve HTTP only).
//
// `onLost` is invoked if the lease connection dies UNEXPECTEDLY (not during a
// graceful release). MySQL drops GET_LOCK when the connection closes, so a dead
// lease connection means another process could acquire the lease and reconcile
// OUR live escrow — a split brain. The only safe response is to fail-stop: the
// caller (server.js) should exit so a supervisor restarts it and re-acquires
// cleanly. Merely logging and continuing to serve is NOT safe.
export async function acquireInstanceLease(onLost = null) {
  if (_leaseConn) return true; // already held by this process
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const [[r]] = await conn.query("SELECT GET_LOCK('riverside_poker_singleton', 0) AS ok");
    if (Number(r.ok) !== 1) {
      conn.release();
      return false;
    }
    _leaseConn = conn; // hold it — do NOT release back to the pool
    conn.on("error", (e) => {
      _leaseConn = null;
      if (_leaseReleasing) return; // expected during releaseInstanceLease()
      console.error("[riverside] instance-lease connection lost — poker singleton lock is gone:", e?.message || e);
      if (onLost) onLost(e);
    });
    return true;
  } catch (err) {
    try { conn.release(); } catch { /* noop */ }
    throw err;
  }
}

// Release the lease on graceful shutdown so the next process can acquire it
// immediately (no wait for MySQL to time out the dead connection).
export async function releaseInstanceLease() {
  const conn = _leaseConn;
  if (!conn) return;
  _leaseReleasing = true;
  _leaseConn = null;
  try { await conn.query("SELECT RELEASE_LOCK('riverside_poker_singleton')"); } catch { /* noop */ }
  try { conn.release(); } catch { /* noop */ }
  _leaseReleasing = false;
}

export function hasInstanceLease() {
  return _leaseConn != null;
}
