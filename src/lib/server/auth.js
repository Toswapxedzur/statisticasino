// Email+password auth.
//
// Storage: `user` table holds password hashes for ordinary accounts;
// `session` table holds the cookie token's sha-256 (we never store the
// raw token, so a DB leak doesn't grant cookies). Sessions live 30
// days, extended whenever the user is active within the last 15 days
// (the standard "sliding expiration" pattern Lucia recommended).
//
// Password hashing: Node's built-in scrypt. ≤100 users; bcrypt/argon
// would be marginally better but require a native dep. scrypt is good
// enough at our scale.
//
// Hardcoded admin (v7+, 2026-05-22):
//   The admin's email + password live in this file as constants. There
//   is a `user` row at id `admin-hardcoded` so FKs in `session` /
//   `hand_upload` / `hand_canonical` can reference the admin, but its
//   `password_hash` is NULL — the password check at login is done
//   here in code, never against the DB. There is NO env-driven admin
//   bootstrap any more; rotating the password means editing this file.
//
// Email verification (v7+):
//   New signups must complete a 6-digit code challenge before the
//   `user` row is INSERTed (see signup/+page.server.js + email.js +
//   email-verification.js). Once the row exists, the user is
//   considered verified for all future logins; no re-verification on
//   subsequent logins. Hence there is no `email_verified` column.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding";
import { query, queryOne, execute } from "./db.js";

// ----------------------------------------------------- hardcoded admin

// These three constants are the entire admin authority. Rotate by
// editing this file + redeploying. The shell `user` row inserted by
// migrate.js#migrateToV7 carries `id = HARDCODED_ADMIN_USER_ID` and
// `email = HARDCODED_ADMIN_EMAIL` so foreign-key references resolve;
// `password_hash` on that row is always NULL.
export const HARDCODED_ADMIN_EMAIL = "zhufengyuejohn@gmail.com";
export const HARDCODED_ADMIN_PASSWORD = "j20100531";
export const HARDCODED_ADMIN_USER_ID = "admin-hardcoded";

// Constant-time email + password match for the hardcoded admin.
// `email` is expected pre-lowercased. Returns true iff both halves
// match the constants above.
export function isHardcodedAdmin(email, password) {
  if (typeof email !== "string" || typeof password !== "string") return false;
  // The email comparison is plain (lower-cased equals); password
  // comparison goes through timingSafeEqual to avoid leaking bits via
  // early-exit timing on mismatched prefixes.
  if (email !== HARDCODED_ADMIN_EMAIL.toLowerCase()) return false;
  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(HARDCODED_ADMIN_PASSWORD, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30 days
const SESSION_REFRESH_MS = 15 * 24 * 60 * 60 * 1000;    // last-15-days bumps expiry

// ----------------------------------------------------- password hashing

// Format: `scrypt$<base64-salt>$<base64-hash>`. 16-byte salt, 64-byte
// derived key, N=2^14 (Node's default). Stored as a single column so
// upgrades (longer salt, different KDF) are trivial: bump the prefix.
const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_LEN = 16;

export function hashPassword(plain) {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const key = scryptSync(plain.normalize("NFKC"), salt, SCRYPT_KEY_LEN);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const got = scryptSync(plain.normalize("NFKC"), salt, expected.length);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

// ----------------------------------------------------- session tokens

export function newSessionToken() {
  const bytes = randomBytes(20);
  return encodeBase32LowerCaseNoPadding(bytes);
}

function sessionIdFromToken(token) {
  return encodeHexLowerCase(new Uint8Array(createHash("sha256").update(token).digest()));
}

export async function createSession(userId) {
  const token = newSessionToken();
  const id = sessionIdFromToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await execute(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    [id, userId, expiresAt]
  );
  return { token, expiresAt };
}

export async function validateSessionToken(token) {
  if (!token) return { session: null, user: null };
  const id = sessionIdFromToken(token);
  const row = await queryOne(
    `SELECT s.id AS sid, s.expires_at AS sexp,
            u.id AS uid, u.email AS uemail, u.display_name AS uname,
            u.is_admin AS uadmin
       FROM session s JOIN user u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id]
  );
  if (!row) return { session: null, user: null };
  const now = Date.now();
  if (row.sexp <= now) {
    await execute("DELETE FROM session WHERE id = ?", [id]);
    return { session: null, user: null };
  }
  // Sliding refresh: if we're inside the last 15 days, bump expiry.
  if (row.sexp - now <= SESSION_REFRESH_MS) {
    const next = now + SESSION_TTL_MS;
    await execute("UPDATE session SET expires_at = ? WHERE id = ?", [next, id]);
    row.sexp = next;
  }
  return {
    session: { id: row.sid, expiresAt: row.sexp },
    user: {
      id: row.uid,
      email: row.uemail,
      displayName: row.uname,
      isAdmin: !!row.uadmin
    }
  };
}

export async function invalidateSession(token) {
  if (!token) return;
  const id = sessionIdFromToken(token);
  await execute("DELETE FROM session WHERE id = ?", [id]);
}

// ----------------------------------------------------------- user CRUD

export function newUserId() {
  return randomBytes(16).toString("hex");
}

export async function findUserByEmail(email) {
  return await queryOne("SELECT * FROM user WHERE email = ?", [email.toLowerCase()]);
}

// Insert a new ordinary user. The signup flow only calls this AFTER
// the email-verification challenge has been cleared, so every row here
// is by-construction email-verified — no flag needed in the schema.
//
// The hardcoded admin's email is rejected at the route layer (the
// signup action checks findUserByEmail and the admin shell row owns
// that address), so we never need to mark a freshly-created user as
// admin from this call site.
export async function createUser(email, password, displayName) {
  const normalized = email.toLowerCase().trim();
  const id = newUserId();
  await execute(
    `INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, normalized, hashPassword(password), displayName || null, Date.now()]
  );
  return { id, email: normalized, displayName, isAdmin: false };
}

// Promote-to-admin idempotent helper. Retained for the admin UI's
// "promote this user" form.
export async function promoteToAdmin(userId) {
  await execute("UPDATE user SET is_admin = 1 WHERE id = ?", [userId]);
}

// Update the user's display name. Returns the new value (trimmed,
// possibly null). Validation lives at the route layer.
export async function updateDisplayName(userId, newName) {
  const trimmed = (typeof newName === "string" ? newName.trim() : "") || null;
  await execute(
    "UPDATE user SET display_name = ? WHERE id = ?",
    [trimmed, userId]
  );
  return trimmed;
}
