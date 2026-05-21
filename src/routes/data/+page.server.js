// Data page loader + admin delete actions (v2).
//
// Soft-delete strategy: we stamp `removed_at` / `removed_by_user_id` on
// `hand_canonical`. Every read path filters with `removed_at IS NULL`
// (see listPlayers, loadHand, +layout.server.js#handCount) so the row
// disappears from every UI without losing the audit trail.
//
// All delete actions re-check `locals.user.isAdmin` server-side; the
// page-level UI gate is just for ergonomics — the action MUST refuse
// non-admin POSTs even if a non-admin hand-crafts the form.
//
// v2 actions (per user spec 2026-05-21 — three-level tree):
//
//   * deleteHands   - select-and-delete per round (multi-select)
//   * deleteTable   - delete every round at one (player, table)
//   * deletePlayer  - delete every round under one player
//

import { fail } from "@sveltejs/kit";
import { getDb } from "$lib/server/db.js";
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

async function softDeleteByHandKeys(db, keys, userId) {
  const now = Date.now();
  const stmt = db.prepare(
    "UPDATE hand_canonical SET removed_at = ?, removed_by_user_id = ? "
    + "WHERE hand_key = ? AND removed_at IS NULL"
  );
  const tx = db.transaction((ks) => {
    let n = 0;
    for (const k of ks) {
      const r = stmt.run(now, userId, k);
      n += r.changes;
    }
    return n;
  });
  return tx(keys);
}

export const actions = {
  deleteHands: async ({ request, locals }) => {
    const denied = requireAdmin(locals); if (denied) return denied;
    const form = await request.formData();
    const keys = form.getAll("handKey").map(String).filter(Boolean);
    if (keys.length === 0) return fail(400, { error: "Pick at least one round." });
    const db = await getDb();
    const deletedCount = await softDeleteByHandKeys(db, keys, locals.user.id);
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
    const db = await getDb();
    const now = Date.now();
    const r = db.prepare(
      "UPDATE hand_canonical SET removed_at = ?, removed_by_user_id = ? "
      + "WHERE player_id = ? AND table_id = ? AND removed_at IS NULL"
    ).run(now, locals.user.id, playerId, tableId);
    return { deletedTable: tableId, deletedCount: r.changes };
  },

  deletePlayer: async ({ request, locals }) => {
    const denied = requireAdmin(locals); if (denied) return denied;
    const form = await request.formData();
    const playerId = String(form.get("playerId") || "");
    if (!playerId) return fail(400, { error: "Missing playerId." });
    const db = await getDb();
    const now = Date.now();
    const r = db.prepare(
      "UPDATE hand_canonical SET removed_at = ?, removed_by_user_id = ? "
      + "WHERE player_id = ? AND removed_at IS NULL"
    ).run(now, locals.user.id, playerId);
    return { deletedPlayer: playerId, deletedCount: r.changes };
  }
};
