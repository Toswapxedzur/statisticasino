// Smoke test for the chips wallet (src/lib/server/wallet.js).
//
// Runs against whatever DB `.env` points at — so ONLY run it against a
// local dev database (never prod). Creates a throwaway user, exercises
// every wallet path, asserts ledger/balance consistency, then deletes
// the user (ledger rows cascade). Run: node scripts/smoke-wallet.js
//
// Mirrors scripts/migrate.js's manual .env loader so it works outside
// SvelteKit.

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
  console.error(`REFUSING to run: MYSQL_HOST=${process.env.MYSQL_HOST} is not local.`);
  process.exit(1);
}

const { execute, query } = await import("../src/lib/server/db.js");
const wallet = await import("../src/lib/server/wallet.js");
const { closePool } = await import("../src/lib/server/db.js");

const uid = "smoke-" + randomBytes(6).toString("hex");
await execute(
  "INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at, chips) VALUES (?,?,?,?,0,?,0)",
  [uid, `${uid}@example.test`, "x", "Smoke", Date.now()]
);

try {
  // Starting grant is idempotent.
  const b1 = await wallet.ensureStartingGrant(uid);
  assert.equal(b1, wallet.STARTING_GRANT, "starting grant applied");
  const b1again = await wallet.ensureStartingGrant(uid);
  assert.equal(b1again, null, "starting grant is one-time");
  assert.equal(await wallet.getBalance(uid), wallet.STARTING_GRANT);

  // Daily bonus once, then blocked by cooldown.
  const d1 = await wallet.claimDailyBonus(uid);
  assert.equal(d1.granted, true, "daily bonus granted");
  const d2 = await wallet.claimDailyBonus(uid);
  assert.equal(d2.granted, false, "daily bonus cooldown");

  const afterBonus = wallet.STARTING_GRANT + wallet.DAILY_BONUS;
  assert.equal(await wallet.getBalance(uid), afterBonus);

  // Debit (buy-in) then credit (cash-out).
  await wallet.debit(uid, 4000, wallet.REASON.TABLE_BUYIN, "table-1");
  assert.equal(await wallet.getBalance(uid), afterBonus - 4000);
  await wallet.credit(uid, 4500, wallet.REASON.TABLE_CASHOUT, "table-1");
  assert.equal(await wallet.getBalance(uid), afterBonus + 500);

  // Overdraw is refused.
  await assert.rejects(
    () => wallet.debit(uid, 10 ** 12, wallet.REASON.TABLE_BUYIN, "x"),
    (e) => e.code === "INSUFFICIENT_CHIPS",
    "overdraw refused"
  );

  // Admin adjust (both directions), floored at zero.
  await wallet.adminAdjust(uid, 1000, "admin-hardcoded");
  await wallet.adminAdjust(uid, -500, "admin-hardcoded");
  const bal = await wallet.getBalance(uid);
  assert.equal(bal, afterBonus + 500 + 500);

  // Ledger reconstructs the balance exactly.
  const rows = await query(
    "SELECT delta FROM chip_ledger WHERE user_id = ?",
    [uid]
  );
  const sum = rows.reduce((a, r) => a + Number(r.delta), 0);
  assert.equal(sum, bal, "ledger sum == balance");

  console.log(`[smoke-wallet] OK — final balance ${bal}, ${rows.length} ledger rows`);
} finally {
  await execute("DELETE FROM user WHERE id = ?", [uid]);
  await closePool();
}
