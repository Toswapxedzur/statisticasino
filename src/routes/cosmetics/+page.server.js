// Cosmetics: preview and equip a ring (round the avatar) and a badge (the seat plate's colour).
// Metals unlock from the player's highest-ever wealth (see $lib/server/cosmetics.js).
import { redirect, fail } from "@sveltejs/kit";
import { queryOne } from "$lib/server/db.js";
import { cosmeticsFor, equip } from "$lib/server/cosmetics.js";
import { hub } from "$lib/server/poker/hub.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const c = await cosmeticsFor(locals.user.id);
  const row = await queryOne("SELECT avatar_media_id FROM user WHERE id = ?", [locals.user.id]);
  return {
    ...c,
    me: { id: locals.user.id, name: locals.user.displayName || locals.user.email, avatarMediaId: row?.avatar_media_id || null }
  };
}

export const actions = {
  equip: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    const fd = await request.formData();
    const res = await equip(locals.user.id, String(fd.get("slot") || ""), String(fd.get("look") || ""));
    if (res.error) return fail(400, { error: res.error });
    // seats and the lobby pick it up at once
    try { hub.setLooks(locals.user.id, { ring: res.ring, badge: res.badge }); } catch { /* next sit carries it */ }
    return { ring: res.ring, badge: res.badge };
  }
};
