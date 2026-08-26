import { redirect } from "@sveltejs/kit";
import { recentActivity } from "$lib/server/activity.js";

export async function load({ locals, url }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const filter = url.searchParams.get("filter") || "all";
  const events = await recentActivity(locals.user.id, { filter });
  return { events, filter };
}
