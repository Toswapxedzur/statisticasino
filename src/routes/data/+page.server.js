// /data — Bluffing Valley's own data hub: your in-game history, another player's
// in-game history (within what they expose and the 7-day horizon), and
// player search (client-side via /api/friends/find). Replaces the old
// casino.org upload tool, which now lives hidden at /casino-data.
import { recentReplaysForUser } from "$lib/server/poker/store.js";
import { historySinceFor, windowStartForUser } from "$lib/server/replay-access.js";
import { getProfile } from "$lib/server/profiles.js";
import { getLeaderboard } from "$lib/server/leaderboards.js";

export async function load({ locals, url }) {
  const me = locals.user ?? null;
  const horizon = historySinceFor(me); // 0 for the owner, now-7d otherwise

  // Ranks (the former /leaderboards) live here as a view.
  const view = url.searchParams.get("view") === "ranks" ? "ranks" : "history";
  let ranks = null;
  if (view === "ranks") {
    const metric = url.searchParams.get("metric") || "chips";
    const timeframe = url.searchParams.get("tf") || "all";
    let scope = url.searchParams.get("scope") || "global";
    if (scope === "friends" && !me) scope = "global";
    const rows = await getLeaderboard({ metric, timeframe, scope, viewerId: me?.id || null });
    ranks = { rows, metric, timeframe, scope };
  }

  const myMatches = me ? await recentReplaysForUser(me.id, { sinceMs: horizon, limit: 100 }) : null;

  let player = null;
  const target = String(url.searchParams.get("u") || "").trim();
  if (target) {
    const profile = await getProfile(target, me?.id ?? null).catch(() => null);
    if (profile) {
      const exposed = await windowStartForUser(target); // null = private
      const isSelf = me?.id === target;
      // The owner sees everything; everyone else needs the player's exposure
      // window AND stays inside the 7-day horizon.
      let since = null;
      if (me?.isAdmin || isSelf) since = horizon;
      else if (exposed !== null && !profile.restricted) since = Math.max(exposed, horizon);
      const matches = since === null ? null : await recentReplaysForUser(target, { sinceMs: since, limit: 100 });
      player = {
        id: target,
        name: profile.name || profile.displayName || "Player",
        avatarMediaId: profile.avatarMediaId ?? null,
        restricted: !!profile.restricted,
        privateHistory: since === null,
        matches
      };
    } else {
      player = { id: target, missing: true };
    }
  }

  return {
    view,
    ranks,
    signedIn: !!me,
    isOwner: !!me?.isAdmin,
    horizonDays: me?.isAdmin ? null : 7,
    myMatches,
    player
  };
}
