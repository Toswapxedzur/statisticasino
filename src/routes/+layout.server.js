// Top-level layout server load: exposes the current user (or null) and
// a few global counts so the topbar's status pill can render with the
// right number on every page.

import { getDb } from "$lib/server/db.js";

export async function load({ locals }) {
  const db = await getDb();
  const handCount = db.prepare(
    "SELECT COUNT(*) AS n FROM hand_canonical WHERE removed_at IS NULL"
  ).get().n;
  return {
    user: locals.user,
    handCount
  };
}
