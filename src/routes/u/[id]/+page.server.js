// A public player profile (S1). Identity + stats gated by the subject's
// profile_visibility; friend actions carried over from the friend graph.
import { error, fail } from "@sveltejs/kit";
import { getProfile } from "$lib/server/profiles.js";
import { requestFriend, respondFriend, removeFriend, areFriends } from "$lib/server/friends.js";
import { getTransferable, transfer } from "$lib/server/transfers.js";
import { block, unblock, hasBlocked, report } from "$lib/server/moderation.js";
import { hub } from "$lib/server/poker/hub.js";
import { windowStartForUser } from "$lib/server/replay-access.js";
import { modeBreakdown, overviewStats } from "$lib/server/stats.js";

export async function load({ params, locals }) {
  const viewerId = locals.user?.id || null;
  const [profile, historySince] = await Promise.all([
    getProfile(params.id, viewerId),
    windowStartForUser(params.id)
  ]);
  if (!profile) throw error(404, "No such player.");
  const blocked = viewerId ? await hasBlocked(viewerId, params.id) : false;
  profile.blocked = blocked;
  const online = (hub.connsForUser?.(params.id) || []).length > 0;
  const table = hub.seatOfUser?.(params.id) || null;
  // The transferable cap is the VIEWER's earned pool — surfaced only in the send
  // dialog. Only meaningful between friends.
  let transferable = 0;
  if (viewerId && viewerId !== params.id && profile.relationship === "friends") {
    transferable = await getTransferable(viewerId);
  }
  let publicStats = null;
  if (!profile.restricted && historySince !== null) {
    const [overview, modes] = await Promise.all([
      overviewStats(params.id, { sinceMs: historySince }),
      modeBreakdown(params.id, { sinceMs: historySince })
    ]);
    publicStats = { overview, modes, sinceMs: historySince };
  }
  return {
    profile,
    transferable,
    publicStats,
    historyPrivate: historySince === null,
    presence: { online, tableId: table?.id || null, tableName: table?.config?.name || null }
  };
}

export const actions = {
  addFriend: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    const res = await requestFriend(locals.user.id, params.id);
    const myName = locals.user.displayName || locals.user.email;
    if (res?.status === "pending") hub.notifyFriendRequest?.(locals.user.id, myName, params.id);
    else if (res?.status === "accepted") hub.notifyFriendAccept?.(locals.user.id, myName, params.id);
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
    hub.notifyFriendAccept?.(locals.user.id, locals.user.displayName || locals.user.email, params.id);
    return { ok: "accepted" };
  },

  // Send chips to this friend. Enforces friends-only + the earned-only cap
  // server-side; notifies both parties live via the hub.
  transfer: async ({ params, locals, request }) => {
    if (!locals.user) return fail(401, { transferError: "Sign in first." });
    const fd = await request.formData();
    const amount = Math.floor(Number(fd.get("amount")));
    if (!Number.isFinite(amount) || amount <= 0) return fail(400, { transferError: "Enter an amount." });
    if (!(await areFriends(locals.user.id, params.id))) return fail(403, { transferError: "You can only send chips to friends." });
    const res = await transfer(locals.user.id, params.id, amount);
    if (res.error) {
      const msg = res.error === "insufficient_transferable"
        ? `You can only send chips you've won at the tables — up to ${res.transferable.toLocaleString()}.`
        : res.error === "insufficient_balance" ? "Not enough chips."
        : "Transfer failed.";
      return fail(400, { transferError: msg });
    }
    try { hub.notifyTransfer?.(locals.user.id, params.id, res.amount, res.fromBalance, res.toBalance); } catch { /* best effort */ }
    return { transferOk: `Sent ${res.amount.toLocaleString()} chips.`, newBalance: res.fromBalance };
  },

  block: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    await block(locals.user.id, params.id);
    return { ok: "blocked" };
  },
  unblock: async ({ params, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    await unblock(locals.user.id, params.id);
    return { ok: "unblocked" };
  },
  report: async ({ params, locals, request }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    const fd = await request.formData();
    await report(locals.user.id, params.id, String(fd.get("reason") || ""));
    return { ok: "reported" };
  },
};
