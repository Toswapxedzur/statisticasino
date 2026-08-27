import { getLeaderboard } from "$lib/server/leaderboards.js";

export async function load({ url, locals }) {
  const metric = url.searchParams.get("metric") || "chips";
  const timeframe = url.searchParams.get("tf") || "all";
  let scope = url.searchParams.get("scope") || "global";
  if (scope === "friends" && !locals.user) scope = "global";
  const rows = await getLeaderboard({ metric, timeframe, scope, viewerId: locals.user?.id || null });
  return { rows, metric, timeframe, scope, signedIn: !!locals.user };
}
