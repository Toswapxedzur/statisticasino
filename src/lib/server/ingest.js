// Hand-envelope ingest (v5).
//
// Accepts an `ExportContainer` (from the extension's flush / export
// pipeline — see casinoMalwareExtension/serialize.js) and writes each
// envelope into the DB.
//
// v5 rules (2026-05-27, "Option B: in-band metadata"):
//
//   * METADATA SOURCE = WS `state` PAYLOAD, EXTRACTED IN THE
//     EXTENSION. The Phoenix `state` event arrives in-band when the
//     extension joins a `table:<id>` socket and carries
//     `{ name, game, stakes, blinds, ... }` from the server. We
//     can't read it server-side because the per-hand frame slice
//     (`startHand .. finishHand`) doesn't include it — the state
//     event lands BEFORE startHand. So `tableize.js` reads it at
//     the bucket level and `serialize.js` stamps the result onto
//     every envelope: `env.tableNames`, `env.gameVariant`,
//     `env.stakesTier`, `env.smallBlind`, `env.bigBlind`.
//
//   * GAME-VARIANT FILTER. `env.gameVariant` must equal "holdem"
//     (case-insensitive) when present. If it's missing — pre-
//     Option-B extension, or no `state` snapshot was captured —
//     we admit on the NL-Hold'em-only assumption that holds for
//     our one supported casino.
//
//   * BLINDS. Preferred source: `env.smallBlind` / `env.bigBlind`
//     (from `state.blinds`). Fallback: the `blinds` action's
//     `players[].bet` values extracted from the frame slice (legacy
//     path, same code as v4). At least one path must succeed or we
//     reject via `summary.rejectedNoStakes`.
//
//   * STAKES TIER. Preferred source: `env.stakesTier` (from
//     `state.stakes` — "low" / "mid" / "high"). Fallback: derived
//     from big_blind via `deriveStakesTierFromBlinds`. Stored on
//     `casino_table.stakes_tier`.
//
//   * BETTING LIMIT. Hardcoded "No Limit" — Replay Poker, the sole
//     casino we support, offers nothing else and the `state` payload
//     carries no limit field. The column stays NULLable for future
//     casinos that may signal it in-band.
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
import { tx } from "./db.js";
import { resolvePerspectivePlayer } from "./perspective.js";
import {
  extractStakeFromFrames,
  deriveStakesTierFromBlinds
} from "./table-meta.js";

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

// Replay Poker — the sole casino we support — only offers NL Hold'em
// rings, and the WS state payload doesn't carry a limit field. Every
// row we accept gets hardcoded to this until a future casino's state
// payload gives us a real signal.
const ASSUMED_BETTING_LIMIT = "No Limit";

// Upsert one casino_table row from the data we just extracted.
//
// Names: read-modify-write merge so multiple observed names (the
// table got renamed mid-life — rare but possible) all accumulate.
// New observations are appended; we never drop a name we've
// previously stored.
//
// stakes_tier: prefer the authoritative `state.stakes`. Once a row
// has a tier we keep it (the casino doesn't reclassify tables).
//
// betting_limit / small_blind / big_blind: first observation wins;
// updates are no-ops via `col = col` in ON DUPLICATE KEY UPDATE.
async function upsertCasinoTable(conn, meta) {
  const [existingRows] = await conn.query(
    "SELECT names_json, stakes_tier FROM casino_table WHERE id = ? LIMIT 1",
    [meta.tableId]
  );
  const names = Array.isArray(meta.names) ? meta.names.slice() : [];
  let stakesTier = meta.stakesTier;
  if (existingRows.length > 0) {
    const prev = existingRows[0];
    try {
      const prevNames = prev.names_json ? JSON.parse(prev.names_json) : [];
      if (Array.isArray(prevNames)) {
        for (const n of prevNames) {
          if (typeof n === "string" && names.indexOf(n) === -1) names.push(n);
        }
      }
    } catch { /* ignore corrupt prior JSON */ }
    if (!stakesTier && prev.stakes_tier) stakesTier = prev.stakes_tier;
  }

  await conn.query(
    `INSERT INTO casino_table
       (id, names_json, small_blind, big_blind, betting_limit,
        stakes_tier, first_seen_ts, last_seen_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       names_json    = VALUES(names_json),
       small_blind   = small_blind,
       big_blind     = big_blind,
       betting_limit = COALESCE(betting_limit, VALUES(betting_limit)),
       stakes_tier   = COALESCE(stakes_tier,   VALUES(stakes_tier)),
       first_seen_ts = LEAST(first_seen_ts, VALUES(first_seen_ts)),
       last_seen_ts  = GREATEST(last_seen_ts, VALUES(last_seen_ts))`,
    [
      meta.tableId,
      names.length ? JSON.stringify(names) : null,
      meta.smallBlind,
      meta.bigBlind,
      ASSUMED_BETTING_LIMIT,
      stakesTier,
      meta.firstTs,
      meta.lastTs
    ]
  );
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
    rejectedVariant: 0,
    rejectedNoStakes: 0,
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

  const now = Date.now();

  // Wrap the whole batch in one transaction for speed + atomicity.
  // The mysql2 PoolConnection passed to the callback supports
  // .query(sql, params) which we use exclusively for the duration.
  await tx(async (conn) => {
    for (const env of container.hands) {
      summary.received++;
      try {
        if (!env.tableId) throw new Error(`hand missing tableId`);

        // 1. Reject anything that isn't a fully-finished round.
        const lifecycle = env.lifecycle || "incomplete";
        if (lifecycle !== "finished") {
          summary.rejectedIncomplete++;
          continue;
        }

        // 1b. Game-variant filter. The extension (tableize.js, post-
        //     Option-B) stamps `gameVariant` from `state.game` onto
        //     every envelope. If it's present and isn't holdem,
        //     reject. Missing field => pre-Option-B extension or no
        //     state snapshot captured => admit on the
        //     casino-supports-only-holdem assumption.
        const envVariant = typeof env.gameVariant === "string"
          ? env.gameVariant.toLowerCase()
          : null;
        if (envVariant && envVariant !== "holdem") {
          summary.rejectedVariant++;
          continue;
        }

        // 1c. Resolve blinds. Envelope fields are authoritative
        //     (from `state.blinds`); fall back to the `blinds`
        //     action in the frame slice so legacy / state-less
        //     captures still get sb/bb. Reject if neither produces
        //     a usable pair — casino_table NOT NULLs.
        let smallBlind = Number(env.smallBlind) || null;
        let bigBlind   = Number(env.bigBlind)   || null;
        if (!smallBlind || !bigBlind) {
          const stake = extractStakeFromFrames(env.frames || []);
          if (stake) {
            smallBlind = stake.smallBlind;
            bigBlind   = stake.bigBlind;
          }
        }
        if (!smallBlind || !bigBlind) {
          summary.rejectedNoStakes++;
          continue;
        }

        // 1d. Stakes tier. Prefer `env.stakesTier` (from
        //     `state.stakes`); fall back to the big-blind threshold
        //     so legacy / state-less captures still get a
        //     classification.
        const stakesTier =
          (typeof env.stakesTier === "string" && env.stakesTier.length > 0
            ? env.stakesTier.toLowerCase()
            : null)
          || deriveStakesTierFromBlinds(bigBlind);

        // 1e. Names list. The extension's `tableNames` is now sourced
        //     from `state.name` (Option B); legacy values may have
        //     come from `document.title` and are accepted as-is.
        const names = Array.isArray(env.tableNames)
          ? env.tableNames.filter((n) => typeof n === "string" && n.length > 0)
          : (typeof env.tableName === "string" && env.tableName.length > 0
              ? [env.tableName]
              : []);

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
        //
        //    Lookup precedence (post-2026-05-28 fix for the dup-rows
        //    bug described in chat):
        //      1. casino_user_id, when the perspective resolver gave us
        //         one. This is the stable casino-side identity and is
        //         the same regardless of whether the username happened
        //         to be in the flush-time userIndex.
        //      2. name, otherwise. Used for rows with no resolvable
        //         userId (the "Seat N @ tableId" branch of
        //         resolvePerspectivePlayer) and for the synthetic
        //         [Generic] bucket.
        //
        //    Without #1 the ingest would happily create a duplicate
        //    casino_player row every time the userIndex was stale —
        //    one named "RealName" from the first hot capture, one
        //    named "User <N>" from later stale captures, even though
        //    both rows share the same casino_user_id.
        let playerRow = null;
        if (playerCasinoUserId != null) {
          const [byId] = await conn.query(
            "SELECT id, name, casino_user_id FROM casino_player WHERE casino_user_id = ? LIMIT 1",
            [playerCasinoUserId]
          );
          playerRow = byId[0] || null;
        }
        if (!playerRow) {
          const [byName] = await conn.query(
            "SELECT id, name, casino_user_id FROM casino_player WHERE name = ? LIMIT 1",
            [playerName]
          );
          playerRow = byName[0] || null;
        }

        let playerId;
        if (!playerRow) {
          playerId = newId();
          await conn.query(
            "INSERT INTO casino_player (id, name, casino_user_id, first_seen_ts, last_seen_ts) "
            + "VALUES (?, ?, ?, ?, ?)",
            [
              playerId,
              playerName,
              playerCasinoUserId,
              env.firstTs || now,
              env.lastTs || now
            ]
          );
        } else {
          playerId = playerRow.id;

          // Auto-promote synthetic names ("User 1234", "Seat 3 @ ...")
          // to the incoming real name when ingest finds a *better*
          // candidate. "Better" = the new name is not itself synthetic.
          // Wrapped in try/catch so a UNIQUE-name collision (some
          // other row already holds the real name) silently leaves
          // the synthetic name in place — the manual rename script
          // can clean those up.
          const synthetic = /^(?:User [0-9]+|Seat [0-9]+ @ .+)$/;
          const incomingIsSynthetic = synthetic.test(playerName);
          const existingIsSynthetic = synthetic.test(playerRow.name);
          if (existingIsSynthetic && !incomingIsSynthetic
              && playerName !== playerRow.name) {
            try {
              await conn.query(
                "UPDATE casino_player SET name = ? WHERE id = ?",
                [playerName, playerId]
              );
            } catch (_e) {
              /* unique-key conflict: another row already owns this
                 name; leave the synthetic in place. */
            }
          }

          await conn.query(
            "UPDATE casino_player "
            + "   SET last_seen_ts   = GREATEST(last_seen_ts, ?), "
            + "       first_seen_ts  = LEAST(first_seen_ts, ?), "
            + "       casino_user_id = COALESCE(casino_user_id, ?) "
            + " WHERE id = ?",
            [
              env.lastTs || now,
              env.firstTs || now,
              playerCasinoUserId,
              playerId
            ]
          );
        }

        // 4. Per-player dedup.
        // Post v5 (2026-05-22), deletes are hard `DELETE FROM
        // hand_canonical`, so any row visible here is a live row.
        // Re-uploads of a hand that was deleted just take the
        // !existing branch and INSERT cleanly. If you ever revive
        // soft-delete, this query MUST also filter on whatever
        // tombstone column you add — the prior bug we fixed was
        // exactly this query happily matching tombstoned rows and
        // mis-classifying re-uploads as duplicates.
        const dedupId = handDedupId(env);
        const [existingRows] = await conn.query(
          "SELECT hand_key, content_hash FROM hand_canonical "
          + "WHERE player_id = ? AND table_id = ? AND hand_dedup_id = ? LIMIT 1",
          [playerId, String(env.tableId), dedupId]
        );
        const existing = existingRows[0];

        const uploadHash = envContentHash(env);
        const uploadId = newId();

        // 4b. Upsert the parent casino_table row. We do this for
        //     duplicates too so a renamed table's names_json grows
        //     monotonically. JSON_MERGE_PRESERVE would be cleaner
        //     but every server we target is MySQL 8 with default
        //     behaviour, and a read-modify-write loop is fine at
        //     ingest cadence.
        await upsertCasinoTable(conn, {
          tableId: String(env.tableId),
          names,
          smallBlind,
          bigBlind,
          stakesTier,
          firstTs: env.firstTs || now,
          lastTs: env.lastTs || now
        });

        let isCanonical = 0;
        let handKey;
        if (!existing) {
          handKey = buildHandKey(playerId, env.tableId, dedupId);
          await conn.query(
            "INSERT INTO hand_canonical "
            + "  (hand_key, player_id, table_id, hand_id, hand_dedup_id, "
            + "   first_ts, last_ts, "
            + "   hero_seat, hero_hole_cards_json, "
            + "   frames_blob, content_hash, created_at, first_uploader_user_id) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              handKey,
              playerId,
              String(env.tableId),
              env.handId ? String(env.handId) : null,
              dedupId,
              env.firstTs || 0,
              env.lastTs || 0,
              heroSeat,
              heroHoleCardsJson,
              gzipFrames(env.frames || []),
              uploadHash,
              now,
              userId || null
            ]
          );
          isCanonical = 1;
          summary.accepted++;
          if (isGenericRow) summary.acceptedGeneric++;
        } else {
          handKey = existing.hand_key;
          summary.duplicates++;
        }

        await conn.query(
          "INSERT INTO hand_upload "
          + "  (id, hand_key, user_id, uploaded_at, content_hash, is_canonical) "
          + "VALUES (?, ?, ?, ?, ?, ?)",
          [uploadId, handKey, userId || null, now, uploadHash, isCanonical]
        );
      } catch (e) {
        summary.errors.push(String(e && e.message || e));
      }
    }
  });

  return summary;
}
