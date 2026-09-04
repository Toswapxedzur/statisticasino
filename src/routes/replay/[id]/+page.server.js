// One recorded match, expanded into viewer frames server-side (the raw replay
// document — above all the deck — never leaves the server). Access:
//   participant → full frames + their own hole cards (+ showdown reveals);
//   public      → frames with only showdown-revealed cards, allowed only when
//                 some participant's history_window exposes this match;
//   otherwise   → 404 (indistinguishable from a nonexistent replay).
import { error } from "@sveltejs/kit";
import { replayById } from "$lib/server/poker/store.js";
import { replayAccess } from "$lib/server/replay-access.js";
import { expandFrames, visibleHoleSeats } from "$lib/server/replay-frames.js";

export async function load({ params, locals }) {
  const row = await replayById(params.id);
  if (!row) throw error(404, "Not found");

  const viewerId = locals.user?.id ?? null;
  const access = await replayAccess(row, row.players, viewerId);
  if (!access) throw error(404, "Not found");

  const doc = JSON.parse(row.replay_json);
  const expanded = expandFrames(doc);

  // Redact hole cards down to what this viewer could have seen at the table.
  let holes = null;
  if (expanded?.kind === "poker" && expanded.holes) {
    const visible = visibleHoleSeats(doc, row.players, access === "participant" ? viewerId : null);
    holes = {};
    for (const seat of visible) {
      if (expanded.holes[seat]) holes[seat] = expanded.holes[seat];
    }
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
    players: row.players.map((p) => ({
      userId: p.user_id, seat: p.seat, name: p.display_name, role: p.role, net: Number(p.net)
    })),
    kind: expanded?.kind ?? null,
    frames: expanded?.frames ?? null,
    holes,
    // Summary fallback if re-simulation failed (engine drift on an old replay).
    final: expanded ? null : (doc.final ?? null)
  };
}
