// Read helpers that aggregate canonical hands into the tableId-rooted
// tree the data page renders. Mirrors the extension's `tableize.js`
// grouping, but the source is SQLite rather than the in-memory message
// log: each `hand_canonical` row contributes one round, and `tableId`
// is the obvious group key.

import { getDb } from "./db.js";

function parseNames(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
}

// Build the [{ tableId, names[], firstTs, lastTs, handCount, hands[] }]
// tree the data page renders. Hands are oldest-first within a table so
// the UI's reverse() puts the latest at the top.
export async function listTables() {
  const db = await getDb();
  const rows = db.prepare(`
    SELECT
      c.hand_key, c.table_id, c.hand_id, c.first_ts, c.last_ts,
      c.table_names_json, c.first_uploader_user_id,
      (SELECT COUNT(*) FROM hand_perspective p WHERE p.hand_key = c.hand_key) AS perspective_count,
      (SELECT COUNT(*) FROM hand_upload u WHERE u.hand_key = c.hand_key) AS upload_count,
      (SELECT COUNT(*) FROM comment cm WHERE cm.hand_key = c.hand_key AND cm.removed_at IS NULL) AS comment_count
    FROM hand_canonical c
    WHERE c.removed_at IS NULL
    ORDER BY c.first_ts ASC
  `).all();

  // Group by table_id, accumulate the union of names across all hands
  // (insertion-order preserved, dedup).
  const byTable = new Map();
  for (const r of rows) {
    let t = byTable.get(r.table_id);
    if (!t) {
      t = {
        tableId: r.table_id,
        names: [],
        firstTs: r.first_ts,
        lastTs: r.last_ts,
        hands: []
      };
      byTable.set(r.table_id, t);
    }
    for (const n of parseNames(r.table_names_json)) {
      if (t.names.indexOf(n) === -1) t.names.push(n);
    }
    t.firstTs = Math.min(t.firstTs, r.first_ts);
    t.lastTs = Math.max(t.lastTs, r.last_ts);
    t.hands.push({
      handKey: r.hand_key,
      handId: r.hand_id,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
      perspectiveCount: r.perspective_count,
      uploadCount: r.upload_count,
      commentCount: r.comment_count
    });
  }

  // Newest-first by last activity across the whole table.
  return Array.from(byTable.values())
    .sort((a, b) => b.lastTs - a.lastTs);
}

// Fetch a single hand's bytes (gunzipped JSON frames + perspectives +
// comments) for the inline replay panel.
export async function loadHand(handKey) {
  const db = await getDb();
  const canonical = db.prepare(`
    SELECT hand_key, table_id, hand_id, first_ts, last_ts,
           table_names_json, frames_blob, created_at,
           first_uploader_user_id
    FROM hand_canonical
    WHERE hand_key = ? AND removed_at IS NULL
  `).get(handKey);
  if (!canonical) return null;

  const perspectives = db.prepare(`
    SELECT seat_id, hole_cards_json
    FROM hand_perspective
    WHERE hand_key = ?
    ORDER BY seat_id
  `).all(handKey);

  const uploads = db.prepare(`
    SELECT u.id, u.perspective_seat_id, u.user_id, u.uploaded_at, u.is_canonical,
           usr.email AS uploader_email, usr.display_name AS uploader_display
    FROM hand_upload u LEFT JOIN user usr ON usr.id = u.user_id
    WHERE u.hand_key = ?
    ORDER BY u.uploaded_at ASC
  `).all(handKey);

  return {
    handKey: canonical.hand_key,
    tableId: canonical.table_id,
    handId: canonical.hand_id,
    firstTs: canonical.first_ts,
    lastTs: canonical.last_ts,
    tableNames: parseNames(canonical.table_names_json),
    framesBlob: canonical.frames_blob,
    perspectives: perspectives.map((p) => ({
      seatId: p.seat_id,
      holeCards: (() => { try { return JSON.parse(p.hole_cards_json); } catch { return null; } })()
    })),
    uploads: uploads.map((u) => ({
      id: u.id,
      seatId: u.perspective_seat_id,
      uploader: u.uploader_email
        ? (u.uploader_display || u.uploader_email)
        : null,        // null => anonymous
      uploadedAt: u.uploaded_at,
      isCanonical: !!u.is_canonical
    }))
  };
}
