// Read helpers that aggregate canonical hands into the three-level
// tree the /data page renders (v2):
//
//   players: [{
//     id, name, casinoUserId,
//     firstTs, lastTs, handCount,
//     tables: [{
//       tableId, names[], firstTs, lastTs, handCount,
//       hands: [{ handKey, handId, firstTs, lastTs, heroSeat,
//                 uploadCount, commentCount }, ...]
//     }, ...]
//   }, ...]
//
// Sort order (newest-first by recency at every level):
//   * Players: descending last_seen_ts.
//   * Tables within a player: descending most-recent hand last_ts.
//   * Hands within a table: ascending first_ts (the UI .reverse()s
//     so the most recent round shows on top — preserves the v1
//     contract.).

import { getDb } from "./db.js";

function parseNames(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
}

export async function listPlayers() {
  const db = await getDb();

  // One row per non-removed canonical hand, joined to its player
  // parent + a couple of cheap counts. Filtering at the SQL layer
  // keeps the JS-side grouping straightforward.
  const rows = db.prepare(`
    SELECT
      p.id           AS player_id,
      p.name         AS player_name,
      p.casino_user_id,
      p.first_seen_ts AS player_first_seen_ts,
      p.last_seen_ts  AS player_last_seen_ts,
      c.hand_key,
      c.table_id,
      c.hand_id,
      c.hand_dedup_id,
      c.first_ts,
      c.last_ts,
      c.table_names_json,
      c.hero_seat,
      (SELECT COUNT(*) FROM hand_upload u WHERE u.hand_key = c.hand_key) AS upload_count,
      (SELECT COUNT(*) FROM comment cm WHERE cm.hand_key = c.hand_key AND cm.removed_at IS NULL) AS comment_count
    FROM hand_canonical c
    JOIN casino_player p ON p.id = c.player_id
    WHERE c.removed_at IS NULL
    ORDER BY p.last_seen_ts DESC, c.first_ts ASC
  `).all();

  // Group: player -> table -> hands.
  const byPlayer = new Map();
  for (const r of rows) {
    let player = byPlayer.get(r.player_id);
    if (!player) {
      player = {
        id: r.player_id,
        name: r.player_name,
        casinoUserId: r.casino_user_id,
        firstTs: r.player_first_seen_ts,
        lastTs: r.player_last_seen_ts,
        handCount: 0,
        tables: new Map()       // tableId -> tableObj; flattened on return
      };
      byPlayer.set(r.player_id, player);
    }

    let table = player.tables.get(r.table_id);
    if (!table) {
      table = {
        tableId: r.table_id,
        names: [],
        firstTs: r.first_ts,
        lastTs: r.last_ts,
        hands: []
      };
      player.tables.set(r.table_id, table);
    }
    for (const n of parseNames(r.table_names_json)) {
      if (table.names.indexOf(n) === -1) table.names.push(n);
    }
    table.firstTs = Math.min(table.firstTs, r.first_ts);
    table.lastTs = Math.max(table.lastTs, r.last_ts);
    table.hands.push({
      handKey: r.hand_key,
      handId: r.hand_id,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
      heroSeat: r.hero_seat,
      uploadCount: r.upload_count,
      commentCount: r.comment_count
    });

    player.handCount++;
    player.firstTs = Math.min(player.firstTs, r.first_ts);
    player.lastTs = Math.max(player.lastTs, r.last_ts);
  }

  // Flatten Maps -> arrays, sort tables newest-first within each
  // player, and sort players newest-first overall. Hands stay
  // chronological so the UI's `.reverse()` puts the newest on top.
  const players = Array.from(byPlayer.values()).map((p) => {
    const tables = Array.from(p.tables.values()).map((t) => ({
      ...t,
      handCount: t.hands.length
    })).sort((a, b) => b.lastTs - a.lastTs);
    return { ...p, tables };
  }).sort((a, b) => b.lastTs - a.lastTs);

  return players;
}

// Fetch a single hand's bytes (gunzipped JSON frames + hero +
// uploads) for the inline replay panel.
export async function loadHand(handKey) {
  const db = await getDb();
  const canonical = db.prepare(`
    SELECT
      c.hand_key, c.table_id, c.hand_id, c.first_ts, c.last_ts,
      c.table_names_json, c.frames_blob, c.created_at,
      c.hero_seat, c.hero_hole_cards_json,
      c.first_uploader_user_id,
      p.id AS player_id, p.name AS player_name, p.casino_user_id
    FROM hand_canonical c
    JOIN casino_player p ON p.id = c.player_id
    WHERE c.hand_key = ? AND c.removed_at IS NULL
  `).get(handKey);
  if (!canonical) return null;

  const uploads = db.prepare(`
    SELECT u.id, u.user_id, u.uploaded_at, u.is_canonical,
           usr.email AS uploader_email, usr.display_name AS uploader_display
    FROM hand_upload u LEFT JOIN user usr ON usr.id = u.user_id
    WHERE u.hand_key = ?
    ORDER BY u.uploaded_at ASC
  `).all(handKey);

  let heroHoleCards = null;
  try { heroHoleCards = JSON.parse(canonical.hero_hole_cards_json); }
  catch { heroHoleCards = null; }

  return {
    handKey: canonical.hand_key,
    tableId: canonical.table_id,
    handId: canonical.hand_id,
    firstTs: canonical.first_ts,
    lastTs: canonical.last_ts,
    tableNames: parseNames(canonical.table_names_json),
    framesBlob: canonical.frames_blob,
    heroSeat: canonical.hero_seat,
    heroHoleCards,
    player: {
      id: canonical.player_id,
      name: canonical.player_name,
      casinoUserId: canonical.casino_user_id
    },
    uploads: uploads.map((u) => ({
      id: u.id,
      uploader: u.uploader_email
        ? (u.uploader_display || u.uploader_email)
        : null,
      uploadedAt: u.uploaded_at,
      isCanonical: !!u.is_canonical
    }))
  };
}

// Bulk variant of loadHand for the "Export selected" actions on
// /data. Returns one row per handKey in the same shape as loadHand,
// but skips per-hand upload rows (the export endpoints don't need
// them). Removed hands are silently dropped.
export async function loadHandsForExport(handKeys) {
  if (!Array.isArray(handKeys) || handKeys.length === 0) return [];
  const db = await getDb();

  // Chunk the IN-list query — better-sqlite3 prepared statements
  // have a hard limit on bound parameters (~32k by default but the
  // SQLite default is 999), so 500 is a safe slice size.
  const CHUNK = 500;
  const out = [];
  for (let i = 0; i < handKeys.length; i += CHUNK) {
    const slice = handKeys.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT
        c.hand_key, c.table_id, c.hand_id, c.first_ts, c.last_ts,
        c.table_names_json, c.frames_blob,
        c.hero_seat, c.hero_hole_cards_json, c.content_hash,
        p.id AS player_id, p.name AS player_name, p.casino_user_id
      FROM hand_canonical c
      JOIN casino_player p ON p.id = c.player_id
      WHERE c.hand_key IN (${placeholders}) AND c.removed_at IS NULL
    `).all(...slice);
    for (const r of rows) {
      let heroHoleCards = null;
      try { heroHoleCards = JSON.parse(r.hero_hole_cards_json); }
      catch { heroHoleCards = null; }
      out.push({
        handKey: r.hand_key,
        tableId: r.table_id,
        handId: r.hand_id,
        firstTs: r.first_ts,
        lastTs: r.last_ts,
        tableNames: parseNames(r.table_names_json),
        framesBlob: r.frames_blob,
        heroSeat: r.hero_seat,
        heroHoleCards,
        contentHash: r.content_hash,
        player: {
          id: r.player_id,
          name: r.player_name,
          casinoUserId: r.casino_user_id
        }
      });
    }
  }
  return out;
}
