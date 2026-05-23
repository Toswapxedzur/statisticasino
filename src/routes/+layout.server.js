// Top-level layout server load: exposes the current user (or null) and
// a few global counts so the topbar's status pill can render with the
// right number on every page.

import { queryOne } from "$lib/server/db.js";

export async function load({ locals }) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM hand_canonical"
  );
  return {
    user: locals.user,
    handCount: row ? Number(row.n) : 0
  };
}
