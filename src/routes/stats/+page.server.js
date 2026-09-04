import { redirect } from "@sveltejs/kit";
import { dailyNet, modeBreakdown, overviewStats, pokerStats } from "$lib/server/stats.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const userId = locals.user.id;
  const [overview, modes, poker, daily] = await Promise.all([
    overviewStats(userId),
    modeBreakdown(userId),
    pokerStats(userId),
    dailyNet(userId)
  ]);
  return { overview, modes, poker, daily };
}

