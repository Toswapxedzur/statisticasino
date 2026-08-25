// Chips wallet — the single-currency economy.
//
// The authoritative balance is `user.chips`; every change is mirrored by
// an append-only `chip_ledger` row inside the SAME transaction, so the
// ledger always reconstructs the balance exactly. All mutations go
// through `applyDelta`, which reads the row `FOR UPDATE` (row lock) so
// concurrent buy-ins / payouts can't race a lost update.
//
// Economy rules (per the owner's choices, 2026-08-16):
//   * Starting grant on signup (idempotent, ledger-gated).
//   * Daily login bonus (once per cooldown window).
//   * Admin grant / adjust.
//   * No auto-refill-on-bust.
//
// Amounts are integers (chips are indivisible). Balances never go
// negative: a debit that would underflow throws INSUFFICIENT_CHIPS.

import { randomBytes } from "node:crypto";
import { tx } from "./db.js";

// ------------------------------------------------------------- constants

export const STARTING_GRANT = 10_000;
export const DAILY_BONUS = 2_000;
// Cooldown between daily-bonus claims. 20h (not a strict 24h) so a player
// who logs in at roughly the same time each day never "misses" the window.
export const DAILY_BONUS_COOLDOWN_MS = 20 * 60 * 60 * 1000;
// Login-streak grace: a claim within this window of the last one CONTINUES the
// streak; a longer gap resets it to 1. 44h ≈ "you came back within a day or so."
// The streak is VISIBLE STATUS ONLY — it never changes the (flat) bonus amount.
export const STREAK_GRACE_MS = 44 * 60 * 60 * 1000;

// Ledger reason tags. Keep these stable — they're persisted.
export const REASON = {
  SIGNUP_GRANT: "signup_grant",
  DAILY_BONUS: "daily_bonus",
  ADMIN_ADJUST: "admin_adjust",
  TABLE_BUYIN: "table_buyin",
  TABLE_CASHOUT: "table_cashout",
  // Tournament entry fee (wallet -> prize pool) and prize payout (pool -> wallet).
  TOURNEY_ENTRY: "tourney_entry",
  TOURNEY_PRIZE: "tourney_prize",
  // Boot reconciliation of crash-persisted on-table escrow (see bank.js).
  ESCROW_REFUND: "escrow_refund"
};

function newLedgerId() {
  return randomBytes(16).toString("hex");
}

// ------------------------------------------------------------- core

// Apply a signed delta to `userId`'s balance within an open tx `conn`,
// writing the ledger row. Returns the new balance. Throws
// INSUFFICIENT_CHIPS if a debit would drive the balance below zero.
//
// Exposed so gameplay code that already holds a transaction (e.g. a
// buy-in that must be atomic with other writes) can compose it; most
// callers use the convenience wrappers below.
export async function applyDelta(conn, userId, delta, reason, ref = null, opKey = null) {
  const [rows] = await conn.query(
    "SELECT chips FROM user WHERE id = ? FOR UPDATE",
    [userId]
  );
  if (rows.length === 0) {
    const e = new Error("no such user");
    e.code = "NO_SUCH_USER";
    throw e;
  }
  const balance = Number(rows[0].chips);
  const next = balance + delta;
  if (next < 0) {
    const e = new Error("insufficient chips");
    e.code = "INSUFFICIENT_CHIPS";
    e.balance = balance;
    e.needed = -delta;
    throw e;
  }
  await conn.execute("UPDATE user SET chips = ? WHERE id = ?", [next, userId]);
  // The ledger row carries the optional idempotency key. If this logical
  // operation already committed (a retry, or a lost-ack re-run), the UNIQUE
  // index on op_key makes this INSERT fail with ER_DUP_ENTRY — that aborts the
  // transaction, rolling back the balance UPDATE above (so no double-apply),
  // and the caller resolves the true outcome via the key (see bank.runIdempotent).
  await conn.execute(
    `INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, ref, op_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newLedgerId(), userId, delta, next, reason, ref, opKey, Date.now()]
  );
  return next;
}

// Look up the resulting balance of a previously-applied idempotency key, or
// null if that key was never committed. Used to resolve an ambiguous money op
// (lost COMMIT ack, or a duplicate-key retry). Standalone read.
export async function balanceForOpKey(opKey) {
  if (!opKey) return null;
  return tx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT balance_after FROM chip_ledger WHERE op_key = ? LIMIT 1",
      [opKey]
    );
    return rows.length ? Number(rows[0].balance_after) : null;
  });
}

// ------------------------------------------------------------- reads

export async function getBalance(userId) {
  return tx(async (conn) => {
    const [rows] = await conn.query("SELECT chips FROM user WHERE id = ?", [userId]);
    return rows.length ? Number(rows[0].chips) : 0;
  });
}

// Recent ledger entries for the account statement / history UI.
export async function recentLedger(userId, limit = 50) {
  return tx(async (conn) => {
    const [rows] = await conn.query(
      `SELECT delta, balance_after, reason, ref, created_at
         FROM chip_ledger WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      [userId, limit]
    );
    return rows;
  });
}

// ------------------------------------------------------------- mutations

// Credit chips (amount > 0). Standalone transaction.
export async function credit(userId, amount, reason, ref = null) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("credit amount must be a positive integer");
  }
  return tx((conn) => applyDelta(conn, userId, amount, reason, ref));
}

// Debit chips (amount > 0). Throws INSUFFICIENT_CHIPS if underfunded.
export async function debit(userId, amount, reason, ref = null) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("debit amount must be a positive integer");
  }
  return tx((conn) => applyDelta(conn, userId, -amount, reason, ref));
}

// Admin adjust: signed delta (+ grant / - claw back). Never drives the
// balance below zero (applyDelta throws instead).
export async function adminAdjust(userId, delta, adminId = null) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("adjust delta must be a non-zero integer");
  }
  return tx((conn) => applyDelta(conn, userId, delta, REASON.ADMIN_ADJUST, adminId));
}

// Give the one-time starting grant if this account has never received
// one. Idempotent: gated on the existence of a SIGNUP_GRANT ledger row,
// so calling it at every login is safe and backfills pre-v10 accounts.
// Returns the new balance if granted, or null if already granted.
export async function ensureStartingGrant(userId) {
  return tx(async (conn) => {
    const [existing] = await conn.query(
      "SELECT 1 FROM chip_ledger WHERE user_id = ? AND reason = ? LIMIT 1",
      [userId, REASON.SIGNUP_GRANT]
    );
    if (existing.length) return null;
    return applyDelta(conn, userId, STARTING_GRANT, REASON.SIGNUP_GRANT, null);
  });
}

// Claim the daily bonus if the cooldown has elapsed. Returns
// { granted, amount?, balance?, nextAt? }.
export async function claimDailyBonus(userId) {
  return tx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT chips, last_daily_bonus_at, daily_streak, best_streak FROM user WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (rows.length === 0) {
      const e = new Error("no such user");
      e.code = "NO_SUCH_USER";
      throw e;
    }
    const now = Date.now();
    const last = rows[0].last_daily_bonus_at ? Number(rows[0].last_daily_bonus_at) : 0;
    if (last && now - last < DAILY_BONUS_COOLDOWN_MS) {
      return { granted: false, nextAt: last + DAILY_BONUS_COOLDOWN_MS };
    }
    // Streak: continue if the previous claim was recent enough, else restart at 1.
    // The bonus AMOUNT is flat — the streak is status only, never a chip multiplier.
    const continued = last > 0 && now - last < STREAK_GRACE_MS;
    const streak = continued ? Number(rows[0].daily_streak || 0) + 1 : 1;
    const best = Math.max(Number(rows[0].best_streak || 0), streak);
    const next = Number(rows[0].chips) + DAILY_BONUS;
    await conn.execute(
      "UPDATE user SET chips = ?, last_daily_bonus_at = ?, daily_streak = ?, best_streak = ? WHERE id = ?",
      [next, now, streak, best, userId]
    );
    await conn.execute(
      `INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newLedgerId(), userId, DAILY_BONUS, next, REASON.DAILY_BONUS, null, now]
    );
    return { granted: true, amount: DAILY_BONUS, balance: next, streak, bestStreak: best };
  });
}

// Is the daily bonus claimable right now? (For rendering the button.)
export function dailyBonusReady(lastDailyBonusAt) {
  const last = lastDailyBonusAt ? Number(lastDailyBonusAt) : 0;
  return !last || Date.now() - last >= DAILY_BONUS_COOLDOWN_MS;
}
