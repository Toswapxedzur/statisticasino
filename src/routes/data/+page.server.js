// Data page loader + admin delete actions (v3).
//
// v3 (2026-05-22, "drop soft-delete"): deletes are hard `DELETE FROM
// hand_canonical` statements. The audit trail in `hand_upload` is
// gone with them via `ON DELETE CASCADE` (schema.sql#fk_hand_upload_hand).
// There is no undelete — re-upload the `.casinodump` if you want a
// hand back. The previous soft-delete approach was abandoned because
// the dedup path in ingest didn't filter `removed_at IS NULL`, so
// re-uploads of a deleted round were silently classified as duplicates
// and dropped on the floor (see DEPLOYMENT.md and chat 2026-05-22).
//
// All delete actions re-check `locals.user.isAdmin` server-side; the
// page-level UI gate is just for ergonomics — the action MUST refuse
// non-admin POSTs even if a non-admin hand-crafts the form.
//
// Three actions (three-level tree):
//   * deleteHands   - select-and-delete per round (multi-select)
//   * deleteTable   - delete every round at one (player, table)
//   * deletePlayer  - delete every round under one player

import { fail } from "@sveltejs/kit";
import { execute, tx } from "$lib/server/db.js";
import { listPlayers } from "$lib/server/tables.js";

export async function load({ locals }) {
  const players = await listPlayers();
  return { players, user: locals.user };
}

function requireAdmin(locals) {
  if (!locals.user || !locals.user.isAdmin) {
    return fail(403, { error: "Admin only." });
  }
  return null;
}

// Hard-delete a list of hand keys inside one transaction. Returns the
// total number of rows actually deleted; missing keys (already deleted
// by another tab, etc.) silently contribute 0.
async function deleteByHandKeys(keys) {
  return await tx(async (conn) => {
    let n = 0;
    for (const k of keys) {
      const [res] = await conn.query(
        "DELETE FROM hand_canonical WHERE hand_key = ?",
        [k]
      );
      n += res.affectedRows ?? 0;
    }
    return n;
  });
}

export const actions = {
  deleteHands: async ({ request, locals }) => {
    const denied = requireAdmin(locals); if (denied) return denied;
    const form = await request.formData();
    const keys = form.getAll("handKey").map(String).filter(Boolean);
    if (keys.length === 0) return fail(400, { error: "Pick at least one round." });
    const deletedCount = await deleteByHandKeys(keys);
    return { deletedCount };
  },

  deleteTable: async ({ request, locals }) => {
    const denied = requireAdmin(locals); if (denied) return denied;
    const form = await request.formData();
    const playerId = String(form.get("playerId") || "");
    const tableId = String(form.get("tableId") || "");
    if (!playerId || !tableId) {
      return fail(400, { error: "Missing playerId / tableId." });
    }
    const r = await execute(
      "DELETE FROM hand_canonical WHERE player_id = ? AND table_id = ?",
      [playerId, tableId]
    );
    return { deletedTable: tableId, deletedCount: r.affectedRows };
  },

  deletePlayer: async ({ request, locals }) => {
    const denied = requireAdmin(locals); if (denied) return denied;
    const form = await request.formData();
    const playerId = String(form.get("playerId") || "");
    if (!playerId) return fail(400, { error: "Missing playerId." });
    const r = await execute(
      "DELETE FROM hand_canonical WHERE player_id = ?",
      [playerId]
    );
    return { deletedPlayer: playerId, deletedCount: r.affectedRows };
  }
};
