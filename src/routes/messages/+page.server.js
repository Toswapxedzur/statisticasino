import { redirect } from "@sveltejs/kit";
import { listFriends, areFriends } from "$lib/server/friends.js";
import { usersByIds } from "$lib/server/poker/store.js";
import { thread, unreadCounts, markRead } from "$lib/server/dm.js";
import { hub } from "$lib/server/poker/hub.js";

export async function load({ locals, url }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const me = locals.user.id;
  const { friends } = await listFriends(me);
  const names = await usersByIds(friends);
  const { byUser } = await unreadCounts(me);

  const conversations = friends
    .map((id) => ({
      id,
      name: names.get(id)?.name || "Unknown",
      online: (hub.connsForUser?.(id) || []).length > 0,
      unread: byUser.get(id) || 0
    }))
    .sort((a, b) => b.unread - a.unread || (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name));

  // A selected conversation (?to=<friendId>): load its history and mark it read.
  const to = url.searchParams.get("to");
  let active = null;
  if (to && (await areFriends(me, to))) {
    const messages = await thread(me, to, 100);
    await markRead(me, to);
    active = {
      id: to,
      name: names.get(to)?.name || "Unknown",
      online: (hub.connsForUser?.(to) || []).length > 0,
      messages
    };
  }
  return { conversations, active };
}
