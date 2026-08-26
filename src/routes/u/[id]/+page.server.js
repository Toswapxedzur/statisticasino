// A public player profile (S1). Identity + stats gated by the subject's
// profile_visibility; friend actions carried over from the friend graph.
import { error, fail } from "@sveltejs/kit";
import { getProfile } from "$lib/server/profiles.js";
import { requestFriend, respondFriend, removeFriend } from "$lib/server/friends.js";
import { hub } from "$lib/server/poker/hub.js";

export async function load({ params, locals }) {
  const viewerId = locals.user?.id || null;
  const profile = await getProfile(params.id, viewerId);
  if (!profile) throw error(404, "No such player.");
  const online = (hub.connsForUser?.(params.id) || []).length > 0;
  const table = hub.seatOfUser?.(params.id) || null;
  return { profile, presence: { online, tableId: table?.id || null, tableName: table?.config?.name || null } };
}

export const actions = {
  addFriend: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    const res = await requestFriend(locals.user.id, params.id);
    return { ok: res.status };
  },
  removeFriend: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    await removeFriend(locals.user.id, params.id);
    return { ok: "removed" };
  },
  acceptFriend: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    await respondFriend(locals.user.id, params.id, true);
    return { ok: "accepted" };
  },
};
