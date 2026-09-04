import { redirect } from "@sveltejs/kit";
import { recentActivity } from "$lib/server/activity.js";
import { modeBreakdown, overviewStats } from "$lib/server/stats.js";

export async function load({ locals, url }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const filter = url.searchParams.get("filter") || "all";
  const [events, overview, modes] = await Promise.all([
    recentActivity(locals.user.id, { filter }),
    overviewStats(locals.user.id),
    modeBreakdown(locals.user.id)
  ]);
  const bestMode = modes
    .filter((row) => row.role === "player")
    .sort((a, b) => b.net - a.net || b.matches - a.matches)[0] || null;
  return { events, filter, stats: { matches: overview.matches, net: overview.totalNet, bestMode } };
}
