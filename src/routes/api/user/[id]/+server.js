// Compact profile for the avatar popover (name, avatar, relationship, presence,
// stats). Respects profile_visibility via getProfile.
import { json, error } from "@sveltejs/kit";
import { getProfile } from "$lib/server/profiles.js";
import { hub } from "$lib/server/poker/hub.js";

export async function GET({ params, locals }) {
  const p = await getProfile(params.id, locals.user?.id || null);
  if (!p) throw error(404, "No such player.");
  const online = (hub.connsForUser?.(params.id) || []).length > 0;
  return json({ ...p, online });
}
