// Friend actions from the avatar popover + Find tab (no page navigation).
import { json, error } from "@sveltejs/kit";
import { requestFriend, respondFriend, removeFriend } from "$lib/server/friends.js";
import { hub } from "$lib/server/poker/hub.js";

export async function POST({ request, locals }) {
  if (!locals.user) throw error(401, "Sign in.");
  const { userId, action } = await request.json();
  if (!userId || userId === locals.user.id) throw error(400, "Bad target.");
  const myName = locals.user.displayName || locals.user.email;

  if (action === "accept") {
    await respondFriend(locals.user.id, userId, true);
    hub.notifyFriendAccept?.(locals.user.id, myName, userId);
    return json({ status: "friends" });
  }
  if (action === "remove") {
    await removeFriend(locals.user.id, userId);
    return json({ status: "none" });
  }
  // default: send a request (enforces the target's friend_req_policy)
  const r = await requestFriend(locals.user.id, userId);
  if (r?.status === "pending") hub.notifyFriendRequest?.(locals.user.id, myName, userId);
  else if (r?.status === "accepted") hub.notifyFriendAccept?.(locals.user.id, myName, userId);
  return json(r); // { status: pending | accepted | exists | blocked | blocked_fof | self }
}
