import { redirect, fail } from "@sveltejs/kit";
import { queryOne, execute } from "$lib/server/db.js";
import {
  SOCIAL_DEFAULTS,
  parseSocialSettings,
  serializeSocialSettings,
} from "$lib/server/social-settings.js";
import { hub } from "$lib/server/poker/hub.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const row = await queryOne(
    "SELECT friend_req_policy, settings, profile_visibility, history_window FROM user WHERE id = ?",
    [locals.user.id]
  );
  return {
    friendReqPolicy: row?.friend_req_policy || "everyone",
    visibility: row?.profile_visibility || "public",
    historyWindow: row?.history_window || "private",
    settings: parseSocialSettings(row?.settings),
  };
}

export const actions = {
  savePrivacy: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in." });
    const fd = await request.formData();
    const policy = String(fd.get("friendReqPolicy") || "everyone");
    const visibility = String(fd.get("visibility") || "public");
    const pol = ["everyone", "fof", "nobody"].includes(policy) ? policy : "everyone";
    const vis = ["public", "friends", "private"].includes(visibility) ? visibility : "public";
    const historyWindow = String(fd.get("historyWindow") || "private");
    const hw = ["private", "7d"].includes(historyWindow) ? historyWindow : "private";
    await execute("UPDATE user SET friend_req_policy = ?, profile_visibility = ?, history_window = ? WHERE id = ?", [pol, vis, hw, locals.user.id]);
    return { privacyOk: true };
  },
  saveSocial: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in." });
    const fd = await request.formData();
    const s = {};
    for (const k of Object.keys(SOCIAL_DEFAULTS)) s[k] = fd.get(k) === "true";
    await execute("UPDATE user SET settings = ? WHERE id = ?", [serializeSocialSettings(s), locals.user.id]);
    // The WS hub caches these prefs to gate typing / read receipts — drop the
    // stale entry so the change takes effect on the live socket immediately.
    try { hub.invalidateSocialSettings(locals.user.id); } catch { /* hub not attached in some contexts */ }
    return { socialOk: true };
  },
};
