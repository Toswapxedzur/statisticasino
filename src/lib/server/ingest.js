// Hand-envelope ingest (v3).
//
// Accepts an `ExportContainer` (from the extension's flush / export
// pipeline — see casinoMalwareExtension/serialize.js) and writes each
// envelope into the DB.
//
// v3 rules (2026-05-21, "admin can upload generic dumps"):
//
//   * Generic uploads (no detectable perspective — pure spectator
//     captures) are accepted IFF the uploader is an admin. They land
//     under a synthetic top-level Generic player node so admins can
//     curate the data tree. Non-admin uploads still reject generic
//     rounds with `summary.rejectedGeneric`.
//
//   * Generic rounds may COEXIST with the same `(tableId, handId)`
//     under one or more real players. Each lives under its own
//     `casino_player` parent; ingest never merges across them.
//
//   * `hero_seat` and `hero_hole_cards_json` are NULL for generic
//     rows. The replay component falls back to "no red seat" when
//     these are absent.
//
// v2 rules retained:
//
//   * KEYING IS PER-PLAYER. The same `(tableId, handId)` captured from
//     two different perspective owners produces TWO rows under TWO
//     `casino_player` parents, NOT a single merged row. Re-uploads
//     from the SAME player at the same hand collapse to one row.
//
//   * SINGLE HERO PER HAND. We never carry "redSeats[]" — each row
//     stores at most one `hero_seat`.
//
// Container shape:
//   {
//     v, format,
//     userIndex: { [userId]: username },   // optional; populated by
//                                           extension as of 2026-05-21
//     hands: [HandEnvelope, ...]
//   }
//
// Caller contract:
//   ingestContainer(container, uploaderUserId, { isAdmin })
//     - uploaderUserId: site account id, or null for anonymous
//     - opts.isAdmin:    bool. Admins flip generic-uploads from
//                        rejected to accepted. Defaults to false.

// The reserved name for the synthetic top-level bucket that holds
// admin-uploaded generic rounds. Must NEVER collide with a real
// casino-side display name; the casino doesn't accept names containing
// "[" so the brackets are belt-and-braces.
const GENERIC_PLAYER_NAME = "[Generic]";

import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import { getDb, tx } from "./db.js";
import { resolvePerspectivePlayer } from "./perspective.js";

const gunzip = promisify(zlib.gunzip);

// ----------------------------------------------------------- helpers

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

function newId() { return randomBytes(16).toString("hex"); }

// Stable per-(player, table) dedup key for a hand. Mirrors the
// extension's serialize.js#handKey but returns just the hand-half
// (the `<handId>` or `ts-<firstTs>` suffix), not the full
// `${tableId}::${handId}` form, so it composes nicely under a
// per-player UNIQUE INDEX.
function handDedupId(envelope) {
  const h = envelope.handId ? String(envelope.handId) : null;
  if (h && !h.startsWith("hand-")) return h;
  return `ts-${envelope.firstTs || 0}`;
}

// Stable URL-safe key for the canonical row. Composed from the
// player id, table id, and hand dedup id so two players' takes on
// the same round get distinct keys.
function buildHandKey(playerId, tableId, dedupId) {
  return `${playerId}::${tableId}::${dedupId}`;
}

function envContentHash(envelope) {
  // Same canonicalisation rule as the extension: hash {handKey, handId, frames}.
  const canonical = JSON.stringify({
    handKey: envelope.handKey || null,
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
      try {
        return JSON.parse(bytes.toString("utf8"));
      } catch (_e2) {
        // fall through to gzip attempt below
      }
    }
  }

  if (contentEncoding === "gzip" || (firstByte === 0x1f && bytes[1] === 0x8b)) {
    const plain = await gunzip(bytes);
    return JSON.parse(plain.toString("utf8"));
  }

  return JSON.parse(bytes.toString("utf8"));
}

// ---------------------------------------------------------- ingest

// `userId` is the uploader's user id, or null for anonymous uploads.
// `opts.isAdmin` flips the generic-upload behaviour from "reject" to
// "ingest under the Generic player".
//
// Returns a summary { received, accepted, acceptedGeneric,
// rejectedGeneric, rejectedIncomplete, duplicates, errors[] } so the
// upload UI can show what happened. `acceptedGeneric` is a strict
// subset of `accepted`.
//
// Defence in depth (chat 2026-05-21): we refuse to store any envelope
// whose `lifecycle` isn't "finished". The extension itself filters
// these out before flushing, but a manually-uploaded .casinodump can
// reach us via /upload regardless, so we check here too.
export async function ingestContainer(container, userId, opts = {}) {
  const isAdmin = !!opts.isAdmin;
  const summary = {
    received: 0,
    accepted: 0,
    acceptedGeneric: 0,
    rejectedGeneric: 0,
    rejectedIncomplete: 0,
    duplicates: 0,
    errors: []
  };
  if (!container || !Array.isArray(container.hands)) {
    summary.errors.push("container has no hands[] array");
    return summary;
  }

  const userIndex = (container.userIndex && typeof container.userIndex === "object")
    ? container.userIndex
    : {};

  const db = await getDb();
  const now = Date.now();

  // Prepared statements (cached on the connection).
  const selPlayerByName = db.prepare(
    "SELECT id, casino_user_id FROM casino_player WHERE name = ?"
  );
  const insPlayer = db.prepare(`
    INSERT INTO casino_player (id, name, casino_user_id, first_seen_ts, last_seen_ts)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updPlayerSeen = db.prepare(`
    UPDATE casino_player
       SET last_seen_ts   = MAX(last_seen_ts, ?),
           first_seen_ts  = MIN(first_seen_ts, ?),
           casino_user_id = COALESCE(casino_user_id, ?)
     WHERE id = ?
  `);
  const selCanonicalByDedup = db.prepare(
    "SELECT hand_key, content_hash FROM hand_canonical "
    + "WHERE player_id = ? AND table_id = ? AND hand_dedup_id = ?"
  );
  const insCanonical = db.prepare(`
    INSERT INTO hand_canonical
      (hand_key, player_id, table_id, hand_id, hand_dedup_id,
       first_ts, last_ts, table_names_json,
       hero_seat, hero_hole_cards_json,
       frames_blob, content_hash, created_at, first_uploader_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insUpload = db.prepare(`
    INSERT INTO hand_upload
      (id, hand_key, user_id, uploaded_at, content_hash, is_canonical)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Wrap the whole batch in one transaction for speed + atomicity.
  await tx(() => {
    for (const env of container.hands) {
      summary.received++;
      try {
        if (!env.tableId) throw new Error(`hand missing tableId`);

        // 1. Reject anything that isn't a fully-finished round.
        //    `lifecycle` is set extension-side by tableize.js; envelopes
        //    from an old extension that pre-dates the field default to
        //    "incomplete" via serialize.js fallback, so we treat
        //    "missing" as "incomplete" by intent.
        const lifecycle = env.lifecycle || "incomplete";
        if (lifecycle !== "finished") {
          summary.rejectedIncomplete++;
          continue;
        }

        // 2. Resolve the perspective. Three outcomes:
        //    a) `persp` is a real player -> ingest under that player.
        //    b) `persp` is null AND uploader is admin -> ingest under
        //       the synthetic Generic player.
        //    c) `persp` is null AND uploader is non-admin -> reject.
        const persp = resolvePerspectivePlayer(env, userIndex);
        let isGenericRow = false;
        let playerName, playerCasinoUserId, heroSeat, heroHoleCardsJson;
        if (persp) {
          playerName = persp.name;
          playerCasinoUserId = persp.casinoUserId || null;
          heroSeat = persp.seatId;
          heroHoleCardsJson = JSON.stringify(persp.holeCards);
        } else if (isAdmin) {
          isGenericRow = true;
          playerName = GENERIC_PLAYER_NAME;
          playerCasinoUserId = null;
          heroSeat = null;
          heroHoleCardsJson = null;
        } else {
          summary.rejectedGeneric++;
          continue;
        }

        // 3. Find or create the casino_player row that owns this hand.
        //    The Generic player is just a regular row with a reserved
        //    name; nothing in the data tree treats it specially other
        //    than the UI labelling it "Generic".
        let playerRow = selPlayerByName.get(playerName);
        let playerId;
        if (!playerRow) {
          playerId = newId();
          insPlayer.run(
            playerId,
            playerName,
            playerCasinoUserId,
            env.firstTs || now,
            env.lastTs || now
          );
        } else {
          playerId = playerRow.id;
          updPlayerSeen.run(
            env.lastTs || now,
            env.firstTs || now,
            playerCasinoUserId,
            playerId
          );
        }

        // 4. Per-player dedup. Same player + same (tableId, handId|ts)
        //    -> merge into the existing row; otherwise insert a new
        //    one. Two DIFFERENT players at the same round still get
        //    two rows because `player_id` is part of the key —
        //    Generic + RealPlayerA at the same round is two rows by
        //    construction.
        const dedupId = handDedupId(env);
        const existing = selCanonicalByDedup.get(playerId, String(env.tableId), dedupId);

        const uploadHash = envContentHash(env);
        const uploadId = newId();
        const namesJson = env.tableNames
          ? JSON.stringify(env.tableNames)
          : (env.tableName ? JSON.stringify([env.tableName]) : null);

        let isCanonical = 0;
        let handKey;
        if (!existing) {
          handKey = buildHandKey(playerId, env.tableId, dedupId);
          insCanonical.run(
            handKey,
            playerId,
            String(env.tableId),
            env.handId ? String(env.handId) : null,
            dedupId,
            env.firstTs || 0,
            env.lastTs || 0,
            namesJson,
            heroSeat,
            heroHoleCardsJson,
            gzipFrames(env.frames || []),
            uploadHash,
            now,
            userId || null
          );
          isCanonical = 1;
          summary.accepted++;
          if (isGenericRow) summary.acceptedGeneric++;
        } else {
          handKey = existing.hand_key;
          // Same player re-uploaded the same round. Whether bytes are
          // identical or drifted, we keep the FIRST canonical bytes
          // and just record the upload audit.
          if (existing.content_hash === uploadHash) summary.duplicates++;
          else summary.duplicates++; // either way: collapsed.
        }

        insUpload.run(
          uploadId,
          handKey,
          userId || null,
          now,
          uploadHash,
          isCanonical
        );
      } catch (e) {
        summary.errors.push(String(e && e.message || e));
      }
    }
  });

  return summary;
}
