// Email+password auth.
//
// Storage: `user` table holds the password hash; `session` table holds
// the cookie token's sha-256 (we never store the raw token, so a DB
// leak doesn't grant cookies). Sessions live 30 days, extended whenever
// the user is active within the last 15 days (the standard "sliding
// expiration" pattern Lucia recommended).
//
// Password hashing: Node's built-in scrypt. ≤100 users; bcrypt/argon
// would be marginally better but require a native dep on top of
// better-sqlite3, and scrypt is good enough at our scale.
//
// First-admin bootstrap: when a user signs up (or logs in) whose email
// matches `ADMIN_EMAIL`, we set `is_admin = 1` on their row. This makes
// the very first install promote the owner automatically with no manual
// SQL step.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding";
import { getDb } from "./db.js";

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
  // timingSafeEqual throws if buffer lengths differ; guard.
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

// ----------------------------------------------------- session tokens

// 20-byte random token, base32-encoded (~32 chars). The id we store in
// `session.id` is the sha-256 of this token, so a DB read leaks
// nothing usable as a cookie.
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
  const db = await getDb();
  db.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    id, userId, expiresAt
  );
  return { token, expiresAt };
}

export async function validateSessionToken(token) {
  if (!token) return { session: null, user: null };
  const id = sessionIdFromToken(token);
  const db = await getDb();
  const row = db.prepare(`
    SELECT s.id AS sid, s.expires_at AS sexp,
           u.id AS uid, u.email AS uemail, u.display_name AS uname,
           u.is_admin AS uadmin
    FROM session s JOIN user u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(id);
  if (!row) return { session: null, user: null };
  const now = Date.now();
  if (row.sexp <= now) {
    db.prepare("DELETE FROM session WHERE id = ?").run(id);
    return { session: null, user: null };
  }
  // Sliding refresh: if we're inside the last 15 days, bump expiry.
  if (row.sexp - now <= SESSION_REFRESH_MS) {
    const next = now + SESSION_TTL_MS;
    db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(next, id);
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
  const db = await getDb();
  db.prepare("DELETE FROM session WHERE id = ?").run(id);
}

// ----------------------------------------------------------- user CRUD

export function newUserId() {
  // 16 random bytes -> 32 hex chars. Not a real ulid but stable and short.
  return randomBytes(16).toString("hex");
}

export async function findUserByEmail(email) {
  const db = await getDb();
  return db.prepare("SELECT * FROM user WHERE email = ?").get(email.toLowerCase());
}

export async function createUser(email, password, displayName) {
  const adminEnv = await import("$env/dynamic/private").then((m) => m.env).catch(() => process.env);
  const normalized = email.toLowerCase().trim();
  const isAdmin = adminEnv.ADMIN_EMAIL
    && adminEnv.ADMIN_EMAIL.toLowerCase() === normalized
    ? 1 : 0;
  const id = newUserId();
  const db = await getDb();
  db.prepare(`
    INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, normalized, hashPassword(password), displayName || null, isAdmin, Date.now());
  return { id, email: normalized, displayName, isAdmin: !!isAdmin };
}

// Promote-to-admin idempotent helper. Used by the bootstrap path (login
// detects ADMIN_EMAIL match) AND by the admin UI's "promote this user"
// form.
export async function promoteToAdmin(userId) {
  const db = await getDb();
  db.prepare("UPDATE user SET is_admin = 1 WHERE id = ?").run(userId);
}

// Re-check the bootstrap admin email on every login: handles the case
// where the admin signed up BEFORE setting ADMIN_EMAIL in .env.
export async function applyBootstrapPromotion(email) {
  const adminEnv = await import("$env/dynamic/private").then((m) => m.env).catch(() => process.env);
  if (!adminEnv.ADMIN_EMAIL) return;
  if (adminEnv.ADMIN_EMAIL.toLowerCase() !== email.toLowerCase()) return;
  const db = await getDb();
  db.prepare("UPDATE user SET is_admin = 1 WHERE email = ?").run(email.toLowerCase());
}
