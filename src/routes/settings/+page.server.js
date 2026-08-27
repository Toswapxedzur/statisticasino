import { redirect, fail } from "@sveltejs/kit";
import { queryOne, execute } from "$lib/server/db.js";

const DEFAULTS = {
  readReceipts: true, typing: true, allowGroupAdd: true,
  notifyFriendReq: true, notifyMessages: true, notifyTransfers: true,
};

function parseSettings(raw) {
  let s = { ...DEFAULTS };
  try { if (raw) s = { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* defaults */ }
  return s;
}

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const row = await queryOne(
    "SELECT friend_req_policy, settings, profile_visibility FROM user WHERE id = ?",
    [locals.user.id]
  );
  return {
    friendReqPolicy: row?.friend_req_policy || "everyone",
    visibility: row?.profile_visibility || "public",
    settings: parseSettings(row?.settings),
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
    await execute("UPDATE user SET friend_req_policy = ?, profile_visibility = ? WHERE id = ?", [pol, vis, locals.user.id]);
    return { privacyOk: true };
  },
  saveSocial: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in." });
    const fd = await request.formData();
    const s = {};
    for (const k of Object.keys(DEFAULTS)) s[k] = fd.get(k) === "true";
    await execute("UPDATE user SET settings = ? WHERE id = ?", [JSON.stringify(s), locals.user.id]);
    return { socialOk: true };
  },
};
