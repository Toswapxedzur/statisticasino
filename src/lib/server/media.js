// Uploaded media (avatars + chat attachments) backed by Aliyun OSS.
//
// Bytes live in OSS; this module manages the `media` index rows, generates
// short-lived V1-signed upload/download URLs (no SDK dependency — the signature
// is a plain HMAC-SHA1), and sweeps expired attachments. Everything is gated on
// OSS being configured via env (OSS_BUCKET / OSS_ENDPOINT / OSS_ACCESS_KEY_ID /
// OSS_ACCESS_KEY_SECRET); when it isn't, `ossAvailable()` is false and the route
// layer disables media features. (As of 2026-08-26 the Aliyun account returns
// OSS "UserDisable" — media stays disabled until OSS is activated + the key is
// granted OSS access.)

import { createHmac, randomBytes } from "node:crypto";
import * as realDb from "./db.js";

const ATTACH_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;    // 5 MB
const MAX_ATTACH_BYTES = 100 * 1024 * 1024;  // 100 MB

export function ossConfig() {
  const { OSS_BUCKET, OSS_ENDPOINT, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_BUCKET || !OSS_ENDPOINT || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) return null;
  return { bucket: OSS_BUCKET, endpoint: OSS_ENDPOINT, id: OSS_ACCESS_KEY_ID, secret: OSS_ACCESS_KEY_SECRET };
}
export function ossAvailable() { return ossConfig() != null; }

// A V1 query-string-signed OSS URL. `method` GET|PUT|DELETE, `key` the object
// key, `expiresSec` unix seconds. `contentType` must match the PUT header the
// client will send (empty for GET/DELETE).
export function signUrl(method, key, expiresSec, contentType = "", cfg = ossConfig()) {
  if (!cfg) return null;
  const resource = `/${cfg.bucket}/${key}`;
  const stringToSign = `${method}\n\n${contentType}\n${expiresSec}\n${resource}`;
  const signature = createHmac("sha1", cfg.secret).update(stringToSign).digest("base64");
  const q = new URLSearchParams({ OSSAccessKeyId: cfg.id, Expires: String(expiresSec), Signature: signature });
  return `https://${cfg.bucket}.${cfg.endpoint}/${key}?${q.toString()}`;
}

function newId() { return randomBytes(16).toString("hex"); }

// Validate + create a media row (not yet `ready`) and return a signed PUT URL the
// client uploads the bytes to directly. `kind` = 'avatar' | 'attachment'.
export async function createUpload({ uploaderId, kind, mime, bytes }, db = realDb) {
  const cfg = ossConfig();
  if (!cfg) return { error: "media_unavailable" };
  const isAvatar = kind === "avatar";
  if (isAvatar && !IMAGE_MIME.has(mime)) return { error: "bad_type" };
  const max = isAvatar ? MAX_AVATAR_BYTES : MAX_ATTACH_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > max) return { error: "too_large" };

  const id = newId();
  const ext = (mime && mime.split("/")[1]) ? "." + mime.split("/")[1].replace(/[^a-z0-9]/gi, "") : "";
  const prefix = isAvatar ? "avatars" : "attachments";
  const storageKey = `${prefix}/${id}${ext}`;
  const now = Date.now();
  const expiresAt = isAvatar ? null : now + ATTACH_TTL_MS;
  await db.execute(
    "INSERT INTO media (id, uploader_id, kind, mime, bytes, storage_key, created_at, expires_at, ready) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
    [id, uploaderId, kind, mime, bytes, storageKey, now, expiresAt]
  );
  const uploadUrl = signUrl("PUT", storageKey, Math.floor(now / 1000) + 300, mime, cfg);
  return { mediaId: id, storageKey, uploadUrl };
}

export async function confirmUpload(mediaId, uploaderId, db = realDb) {
  await db.execute("UPDATE media SET ready = 1 WHERE id = ? AND uploader_id = ?", [mediaId, uploaderId]);
}

export async function mediaRow(mediaId, db = realDb) {
  const rows = await db.query("SELECT id, uploader_id, kind, mime, storage_key, expires_at, ready FROM media WHERE id = ? LIMIT 1", [mediaId]);
  return rows[0] || null;
}

// A short-lived signed GET URL for a media object (the caller has already checked
// the viewer is allowed to see it).
export function downloadUrl(row, ttlSec = 300, cfg = ossConfig()) {
  if (!cfg || !row) return null;
  return signUrl("GET", row.storage_key, Math.floor(Date.now() / 1000) + ttlSec, "", cfg);
}

// Delete expired attachments: remove the OSS object then the row. Runs on a timer.
export async function cleanupExpired(db = realDb) {
  const cfg = ossConfig();
  if (!cfg) return { deleted: 0, skipped: "no_oss" };
  const now = Date.now();
  const rows = await db.query("SELECT id, storage_key FROM media WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 500", [now]);
  let deleted = 0;
  for (const r of rows) {
    try {
      const url = signUrl("DELETE", r.storage_key, Math.floor(now / 1000) + 120, "", cfg);
      await fetch(url, { method: "DELETE" });
    } catch { /* best effort — the row removal still frees the index */ }
    await db.execute("DELETE FROM media WHERE id = ?", [r.id]);
    deleted += 1;
  }
  return { deleted };
}

// Start the periodic janitor (hourly). No-op when OSS isn't configured.
let _timer = null;
export function startMediaJanitor() {
  if (_timer || !ossAvailable()) return;
  _timer = setInterval(() => { cleanupExpired().catch(() => {}); }, 60 * 60 * 1000);
  _timer.unref?.();
}
