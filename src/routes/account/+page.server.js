import { fail, redirect } from "@sveltejs/kit";
import { getDb } from "$lib/server/db.js";
import { invalidateSession, promoteToAdmin } from "$lib/server/auth.js";
import { SESSION_COOKIE, clearSessionCookie } from "$lib/server/cookies.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");

  const db = await getDb();
  // v2: `hand_upload.perspective_seat_id` is gone — per-row hero seat
  // now lives on `hand_canonical.hero_seat`. Pull it from there.
  const myUploads = db.prepare(`
    SELECT u.id, u.hand_key, u.uploaded_at, u.is_canonical,
           c.table_id, c.first_ts, c.hero_seat,
           p.name AS player_name
    FROM hand_upload u
    LEFT JOIN hand_canonical c ON c.hand_key = u.hand_key
    LEFT JOIN casino_player p ON p.id = c.player_id
    WHERE u.user_id = ?
    ORDER BY u.uploaded_at DESC
    LIMIT 100
  `).all(locals.user.id);

  let allUsers = null;
  if (locals.user.isAdmin) {
    allUsers = db.prepare(`
      SELECT id, email, display_name, is_admin, created_at
      FROM user ORDER BY created_at DESC
    `).all();
  }

  return {
    myUploads,
    allUsers
  };
}

export const actions = {
  logout: async ({ cookies }) => {
    const token = cookies.get(SESSION_COOKIE);
    await invalidateSession(token);
    clearSessionCookie(cookies);
    throw redirect(303, "/");
  },

  promote: async ({ request, locals }) => {
    if (!locals.user || !locals.user.isAdmin) {
      return fail(403, { promoteError: "Admin only." });
    }
    const form = await request.formData();
    const userId = String(form.get("userId") || "");
    if (!userId) return fail(400, { promoteError: "Pick a user." });
    await promoteToAdmin(userId);
    return { promoteOk: true };
  }
};
