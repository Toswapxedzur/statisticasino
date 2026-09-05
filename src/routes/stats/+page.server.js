import { redirect } from "@sveltejs/kit";
import { dailyNet, modeBreakdown, overviewStats, pokerStats } from "$lib/server/stats.js";
import { historySinceFor } from "$lib/server/replay-access.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const userId = locals.user.id;
  // Hard 7-day horizon: only the owner sees beyond it (replay-access.js).
  const sinceMs = historySinceFor(locals.user);
  const [overview, modes, poker, daily] = await Promise.all([
    overviewStats(userId, { sinceMs }),
    modeBreakdown(userId, { sinceMs }),
    pokerStats(userId, { sinceMs }),
    dailyNet(userId, { sinceMs })
  ]);
  return { overview, modes, poker, daily, sinceMs, horizonDays: locals.user.isAdmin ? null : 7 };
}

