// Hand-envelope ingest.
//
// Accepts an `ExportContainer` (from the extension's flush / export
// pipeline — see casinoMalwareExtension/serialize.js) and writes each
// envelope into the DB with first-upload-wins canonical semantics.
//
// Flow per envelope:
//   1. Parse hand_key from envelope or recompute from (tableId, handId, firstTs).
//   2. Compute the upload's content hash (the envelope already carries
//      one; we trust it but recompute as a sanity check).
//   3. Detect perspective owner (seat + hole cards).
//   4. Look up `hand_canonical` by hand_key.
//      - If missing: insert (this upload becomes the canonical bytes).
//      - If present: leave canonical bytes untouched; record this upload
//        as a non-canonical perspective contributor.
//   5. Upsert (hand_key, seat_id) into `hand_perspective`. ON CONFLICT
//      DO NOTHING because the FIRST upload to claim a perspective wins
//      for the perspective row (later uploads from the same seat get
//      recorded in hand_upload but don't bump the perspective row).
//   6. Always insert a `hand_upload` row regardless of canonical-ness.

import { randomBytes, createHash, gunzipSync } from "node:crypto";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import { getDb, tx } from "./db.js";
import { detectPerspective } from "./perspective.js";

const gunzip = promisify(zlib.gunzip);

// ----------------------------------------------------------- helpers

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

function newId() { return randomBytes(16).toString("hex"); }

// Compute the canonical hand_key from the envelope. Mirrors the rule in
// the extension's serialize.js so the same hand keys match across both
// sides.
function handKey(envelope) {
  if (envelope.handKey) return String(envelope.handKey);
  const t = String(envelope.tableId || "unknown");
  const h = envelope.handId ? String(envelope.handId) : null;
  if (h && !h.startsWith("hand-")) return `${t}::${h}`;
  return `${t}::ts-${envelope.firstTs || 0}`;
}

function envContentHash(envelope) {
  // Same canonicalisation rule as the extension: hash {handKey, handId, frames}.
  const canonical = JSON.stringify({
    handKey: envelope.handKey || handKey(envelope),
    handId: envelope.handId || null,
    frames: envelope.frames || []
  });
  return sha256Hex(canonical);
}

// Re-gzip frames so we store a compact blob. We can't trust that the
// uploader sent gzipped frames standalone — the export container was
// gzipped as a whole, but we've already un-gzipped that, so frames[]
// is plain JSON-array bytes when we get here.
function gzipFrames(frames) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(frames)));
}

// --------------------------------------------------- decode container

// `bodyBytes` is the raw POST body. Accepts:
//   - gzipped JSON FlushRequest / ExportContainer (Content-Encoding: gzip), OR
//   - base64-encoded gzipped container (.casinodump file uploaded as form-data text), OR
//   - plain JSON (already decoded by the caller)
// Returns the parsed container object.
export async function decodeContainer(bodyBytes, contentEncoding) {
  if (!bodyBytes || bodyBytes.length === 0) {
    throw new Error("empty body");
  }

  let bytes = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes);

  // .casinodump files are base64 of gzipped JSON. Quick sniff: ASCII-only?
  const firstByte = bytes[0];
  const looksAscii = firstByte >= 32 && firstByte <= 126;
  if (looksAscii) {
    // Try base64 -> gzip -> JSON. If that fails, try plain JSON.
    try {
      const gz = Buffer.from(bytes.toString("utf8").trim(), "base64");
      const plain = await gunzip(gz);
      return JSON.parse(plain.toString("utf8"));
    } catch (_) {
      // fall through to plain JSON below
      try {
        return JSON.parse(bytes.toString("utf8"));
      } catch (_e2) {
        // fall through to gzip attempt below
      }
    }
  }

  // Binary path: gzipped JSON (the network flush format).
  if (contentEncoding === "gzip" || (firstByte === 0x1f && bytes[1] === 0x8b)) {
    const plain = await gunzip(bytes);
    return JSON.parse(plain.toString("utf8"));
  }

  // Last resort: try plain JSON.
  return JSON.parse(bytes.toString("utf8"));
}

// ----------------------------------------------------------- ingest

// `userId` is the uploader's user id, or null for anonymous uploads.
// Returns a summary { received, canonicalCreated, perspectivesAdded,
// duplicates, errors[] } so the upload UI can show what happened.
export async function ingestContainer(container, userId) {
  const summary = {
    received: 0,
    canonicalCreated: 0,
    perspectivesAdded: 0,
    duplicates: 0,
    errors: []
  };
  if (!container || !Array.isArray(container.hands)) {
    summary.errors.push("container has no hands[] array");
    return summary;
  }

  const db = await getDb();
  const now = Date.now();

  // Prepared statements (cached on the connection).
  const selCanonical = db.prepare(
    "SELECT hand_key, content_hash FROM hand_canonical WHERE hand_key = ?"
  );
  const insCanonical = db.prepare(`
    INSERT INTO hand_canonical
      (hand_key, table_id, hand_id, first_ts, last_ts, table_names_json,
       frames_blob, content_hash, created_at, first_uploader_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insUpload = db.prepare(`
    INSERT INTO hand_upload
      (id, hand_key, perspective_seat_id, hole_cards_json, user_id,
       uploaded_at, content_hash, is_canonical)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insPerspective = db.prepare(`
    INSERT INTO hand_perspective
      (hand_key, seat_id, hole_cards_json, first_seen_upload_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (hand_key, seat_id) DO NOTHING
  `);

  // Wrap the whole batch in one transaction for speed + atomicity.
  await tx(() => {
    for (const env of container.hands) {
      summary.received++;
      try {
        const key = handKey(env);
        if (!env.tableId) throw new Error(`hand ${key} missing tableId`);

        const uploadHash = envContentHash(env);
        const perspective = detectPerspective(env);
        const uploadId = newId();
        const namesJson = env.tableNames
          ? JSON.stringify(env.tableNames)
          : (env.tableName ? JSON.stringify([env.tableName]) : null);

        const existing = selCanonical.get(key);
        let isCanonical = 0;
        if (!existing) {
          // First upload of this hand wins. Store its bytes.
          insCanonical.run(
            key,
            String(env.tableId),
            env.handId ? String(env.handId) : null,
            env.firstTs || 0,
            env.lastTs || 0,
            namesJson,
            gzipFrames(env.frames || []),
            uploadHash,
            now,
            userId || null
          );
          isCanonical = 1;
          summary.canonicalCreated++;
        } else if (existing.content_hash === uploadHash) {
          // Exact byte-identical re-upload from the same perspective.
          // Still record the upload (audit) but flag it as a dup.
          summary.duplicates++;
        }
        // (else: a different upload contributes only its perspective)

        insUpload.run(
          uploadId,
          key,
          perspective ? perspective.seatId : null,
          perspective ? JSON.stringify(perspective.holeCards) : null,
          userId || null,
          now,
          uploadHash,
          isCanonical
        );

        if (perspective) {
          const r = insPerspective.run(
            key,
            perspective.seatId,
            JSON.stringify(perspective.holeCards),
            uploadId
          );
          if (r.changes > 0) summary.perspectivesAdded++;
        }
      } catch (e) {
        summary.errors.push(String(e && e.message || e));
      }
    }
  });

  return summary;
}
