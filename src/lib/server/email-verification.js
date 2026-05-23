// Email verification codes for signup.
//
// Flow:
//   1. User types email into signup form, hits "Send code".
//   2. `issueAndSendCode(email)` generates a 6-digit numeric code,
//      stores its sha256 in `email_verification`, and emails the
//      plaintext code to the address.
//   3. User types the code into the form's 4th slot and submits.
//   4. `verifyCode(email, code)` looks up the latest non-expired row
//      for that email, compares hashes, and on success deletes the row
//      (one-shot — a code can't be replayed) before signup proceeds.
//
// Why hash the code rather than store it plaintext: a read-only DB
// leak would otherwise hand an attacker every active signup token.
// Hashing is cheap (sha256) and the search-key is the email, not the
// code, so we don't lose lookup speed.
//
// Rate limit: at most one code issued per email per 30 seconds, and at
// most ~6 codes per email per hour (we just rely on row count rather
// than a separate counter table). The bound is permissive enough for
// retries but cheap enough to thwart casual enumeration.
//
// TTL: 10 minutes. Long enough for the user to switch tabs and grab
// the email; short enough that a leaked email account doesn't stay
// useful indefinitely.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { execute, query, queryOne } from "./db.js";
import { sendEmail } from "./email.js";

const CODE_TTL_MS = 10 * 60 * 1000;           // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;         // 30 seconds between sends
const MAX_CODES_PER_EMAIL_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Issue a fresh 6-digit code, store its hash, and email the plaintext
 * to the address.
 *
 * @param {string} email
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: "rate_limit" | "throttled" | "send_failed",
 *   provider?: string,
 *   retryAfterMs?: number
 * }>}
 */
export async function issueAndSendCode(email) {
  const normalized = email.toLowerCase().trim();
  const now = Date.now();

  // Rate-limit: cooldown since most-recent issue.
  const recent = await queryOne(
    "SELECT created_at FROM email_verification "
    + " WHERE email = ? "
    + " ORDER BY created_at DESC LIMIT 1",
    [normalized]
  );
  if (recent && now - recent.created_at < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      error: "throttled",
      retryAfterMs: RESEND_COOLDOWN_MS - (now - recent.created_at)
    };
  }

  // Rate-limit: max-per-hour.
  const hourAgo = now - HOUR_MS;
  const countRow = await queryOne(
    "SELECT COUNT(*) AS c FROM email_verification "
    + " WHERE email = ? AND created_at > ?",
    [normalized, hourAgo]
  );
  if (countRow && Number(countRow.c) >= MAX_CODES_PER_EMAIL_PER_HOUR) {
    return { ok: false, error: "rate_limit" };
  }

  // Generate the code. crypto.randomInt is uniform across the range so
  // the leading-zero distribution is correct.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = sha256Hex(code);
  const id = randomBytes(16).toString("hex");

  // Drop any stale rows for this email so the table doesn't grow
  // unbounded for users that keep hitting "Send code".
  await execute(
    "DELETE FROM email_verification WHERE email = ? AND expires_at <= ?",
    [normalized, now]
  );

  await execute(
    "INSERT INTO email_verification "
    + "  (id, email, code_hash, created_at, expires_at) "
    + "VALUES (?, ?, ?, ?, ?)",
    [id, normalized, codeHash, now, now + CODE_TTL_MS]
  );

  const subject = "Your Statisticasino verification code";
  const text =
    `Your verification code is: ${code}\n\n`
    + `It expires in 10 minutes. If you did not request this, you can `
    + `safely ignore this message.\n`;
  const html =
    `<p>Your verification code is:</p>`
    + `<p style="font-size:1.6em;font-family:ui-monospace,monospace;letter-spacing:.2em;">`
    + `<strong>${code}</strong></p>`
    + `<p>It expires in 10 minutes. If you did not request this, you `
    + `can safely ignore this message.</p>`;

  const send = await sendEmail({ to: normalized, subject, text, html });
  if (!send.ok) {
    // Don't keep the row if we couldn't deliver — the user will need
    // to retry, and stale codes are noise.
    await execute("DELETE FROM email_verification WHERE id = ?", [id]);
    return { ok: false, error: "send_failed", provider: send.provider };
  }
  return { ok: true, provider: send.provider };
}

/**
 * Validate a code against the most-recent issued row for `email`.
 * On success the row is deleted (codes are one-shot).
 *
 * @param {string} email
 * @param {string} code
 * @returns {Promise<boolean>} true iff the code is valid and unconsumed.
 */
export async function verifyCode(email, code) {
  if (typeof code !== "string") return false;
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;

  const normalized = email.toLowerCase().trim();
  const now = Date.now();
  const row = await queryOne(
    "SELECT id, code_hash FROM email_verification "
    + " WHERE email = ? AND expires_at > ? "
    + " ORDER BY created_at DESC LIMIT 1",
    [normalized, now]
  );
  if (!row) return false;

  const expected = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(sha256Hex(trimmed), "hex");
  if (expected.length !== got.length) return false;
  if (!timingSafeEqual(expected, got)) return false;

  // One-shot: delete the row (and any other still-pending rows for
  // this email) so the same code can't be replayed.
  await execute("DELETE FROM email_verification WHERE email = ?", [normalized]);
  return true;
}

/**
 * Cooldown-aware "is this email allowed to request another code right
 * now?" check, exposed for the UI's "Send code" button.
 */
export async function getResendStatus(email) {
  const normalized = email.toLowerCase().trim();
  const recent = await queryOne(
    "SELECT created_at FROM email_verification "
    + " WHERE email = ? "
    + " ORDER BY created_at DESC LIMIT 1",
    [normalized]
  );
  if (!recent) return { canResend: true };
  const sinceMs = Date.now() - recent.created_at;
  if (sinceMs >= RESEND_COOLDOWN_MS) return { canResend: true };
  return { canResend: false, retryAfterMs: RESEND_COOLDOWN_MS - sinceMs };
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
