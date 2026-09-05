// /data — Riverside's own data hub: your in-game history, another player's
// in-game history (within what they expose and the 7-day horizon), and
// player search (client-side via /api/friends/find). Replaces the old
// casino.org upload tool, which now lives hidden at /casino-data.
import { recentReplaysForUser } from "$lib/server/poker/store.js";
import { historySinceFor, windowStartForUser } from "$lib/server/replay-access.js";
import { getProfile } from "$lib/server/profiles.js";

export async function load({ locals, url }) {
  const me = locals.user ?? null;
  const horizon = historySinceFor(me); // 0 for the owner, now-7d otherwise

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
    signedIn: !!me,
    isOwner: !!me?.isAdmin,
    horizonDays: me?.isAdmin ? null : 7,
    myMatches,
    player
  };
}
