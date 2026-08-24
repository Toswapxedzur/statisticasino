import { fail, redirect } from "@sveltejs/kit";
import { listFriends, requestFriend, respondFriend, removeFriend } from "$lib/server/friends.js";
import { usersByIds, findUserByHandle } from "$lib/server/poker/store.js";
import { hub } from "$lib/server/poker/hub.js";

// Annotate a list of user ids with name + live presence (online / at which table),
// read straight from the in-process hub singleton.
async function decorate(ids) {
  const names = await usersByIds(ids);
  return ids.map((id) => {
    const table = hub.seatOfUser?.(id) || null;
    return {
      id,
      name: names.get(id)?.name || "Unknown",
      online: (hub.connsForUser?.(id) || []).length > 0,
      tableId: table?.id || null,
      tableName: table?.config?.name || null
    };
  });
}

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const { friends, incoming, outgoing } = await listFriends(locals.user.id);
  const [friendRows, incomingRows, outgoingRows] = await Promise.all([
    decorate(friends), decorate(incoming), decorate(outgoing)
  ]);
  // Friends who are online sort to the top.
  friendRows.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name));
  return { friends: friendRows, incoming: incomingRows, outgoing: outgoingRows };
}

export const actions = {
  add: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { addError: "Sign in first." });
    const form = await request.formData();
    const handle = String(form.get("handle") || "").trim();
    if (!handle) return fail(400, { addError: "Enter a display name or email." });
    const target = await findUserByHandle(handle);
    if (!target) return fail(404, { addError: `No player found for "${handle}".` });
    if (target.id === locals.user.id) return fail(400, { addError: "You can't add yourself." });
    const res = await requestFriend(locals.user.id, target.id);
    if (res.status === "exists") return fail(409, { addError: `You're already connected with ${target.name}.` });
    if (res.status === "accepted") return { addOk: `You're now friends with ${target.name}!` };
    return { addOk: `Friend request sent to ${target.name}.` };
  },

  respond: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { respondError: "Sign in first." });
    const form = await request.formData();
    const requesterId = String(form.get("userId") || "");
    const accept = String(form.get("accept")) === "true";
    if (!requesterId) return fail(400, { respondError: "Bad request." });
    await respondFriend(locals.user.id, requesterId, accept);
    return { respondOk: true };
  },

  remove: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { removeError: "Sign in first." });
    const form = await request.formData();
    const otherId = String(form.get("userId") || "");
    if (!otherId) return fail(400, { removeError: "Bad request." });
    await removeFriend(locals.user.id, otherId);
    return { removeOk: true };
  }
};
