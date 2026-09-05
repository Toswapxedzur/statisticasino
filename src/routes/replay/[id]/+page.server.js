// One recorded match, expanded into viewer frames server-side (the raw replay
// document — above all the deck — never leaves the server). Access:
//   participant → full frames + their own hole cards (+ showdown reveals);
//   public      → frames with only showdown-revealed cards, allowed only when
//                 some participant's history_window exposes this match;
//   otherwise   → 404 (indistinguishable from a nonexistent replay).
//
// Tiering: matches past the archive window live on the home archive (mini2);
// the DB keeps only metadata + `final_json`. We fetch the archived document
// through the reverse-SSH tunnel (REPLAY_ARCHIVE_URL → 127.0.0.1:8790 on the
// VPS → mini2) with a short timeout; if home is offline the page degrades to
// the outcome summary.
import { error } from "@sveltejs/kit";
import { gunzipSync } from "node:zlib";
import { replayById } from "$lib/server/poker/store.js";
import { replayAccess } from "$lib/server/replay-access.js";
import { expandFrames, visibleHoleSeats } from "$lib/server/replay-frames.js";

const ARCHIVE_URL = (process.env.REPLAY_ARCHIVE_URL || "").replace(/\/$/, "");
const ARCHIVE_TIMEOUT_MS = 2500;

async function loadDocument(row) {
  if (row.replay_json) return { doc: JSON.parse(row.replay_json), archived: false, offline: false };
  if (row.archive_ref && ARCHIVE_URL) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ARCHIVE_TIMEOUT_MS);
    try {
      const res = await fetch(`${ARCHIVE_URL}/${row.archive_ref}`, { signal: ctrl.signal });
      if (res.ok) {
        const gz = Buffer.from(await res.arrayBuffer());
        return { doc: JSON.parse(gunzipSync(gz).toString("utf8")), archived: true, offline: false };
      }
    } catch {
      /* home archive unreachable — fall through to the summary */
    } finally {
      clearTimeout(timer);
    }
  }
  return { doc: null, archived: row.archived_at != null, offline: true };
}

export async function load({ params, locals }) {
  const row = await replayById(params.id);
  if (!row) throw error(404, "Not found");

  const viewerId = locals.user?.id ?? null;
  const access = await replayAccess(row, row.players, viewerId);
  if (!access) throw error(404, "Not found");

  const { doc, archived, offline } = await loadDocument(row);
  const expanded = doc ? expandFrames(doc) : null;

  // Redact hole cards down to what this viewer could have seen at the table.
  let holes = null;
  if (expanded?.kind === "poker" && expanded.holes) {
    const visible = visibleHoleSeats(doc, row.players, access === "participant" ? viewerId : null);
    holes = {};
    for (const seat of visible) {
      if (expanded.holes[seat]) holes[seat] = expanded.holes[seat];
    }
  }

  let final = null;
  if (!expanded) {
    if (doc?.final) final = doc.final;
    else if (row.final_json) { try { final = JSON.parse(row.final_json); } catch { final = null; } }
  }

  return {
    id: row.id,
    mode: row.mode,
    variant: row.variant,
    context: row.context,
    tableName: row.table_name,
    handNo: row.hand_no == null ? null : Number(row.hand_no),
    startedAt: Number(row.started_at),
    endedAt: Number(row.ended_at),
    potTotal: Number(row.pot_total),
    access,
    archived,
    archiveOffline: archived && offline,
    players: row.players.map((p) => ({
      userId: p.user_id, seat: p.seat, name: p.display_name, role: p.role, net: Number(p.net)
    })),
    kind: expanded?.kind ?? null,
    frames: expanded?.frames ?? null,
    holes,
    // Summary fallback: archive offline, or re-simulation failed (engine drift).
    final
  };
}
