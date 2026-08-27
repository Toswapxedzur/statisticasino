import { fail } from "@sveltejs/kit";
import { queryOne } from "$lib/server/db.js";
import {
  nextRounds, roundView, register, lastFinishedRound, roundResults,
} from "$lib/server/sprint.js";
import { SPRINT } from "$lib/server/sprint-core.js";
import { identities } from "$lib/server/profiles.js";

export async function load({ locals }) {
  const uid = locals.user?.id || null;
  const upcoming = await nextRounds(4);
  const featured = upcoming[0] ? await roundView(upcoming[0].id, uid) : null;

  let lastResults = null, lastRound = null;
  const last = await lastFinishedRound();
  if (last) {
    lastRound = last;
    lastResults = await roundResults(last.id, 12);
  }

  const chips = uid ? Number((await queryOne("SELECT chips FROM user WHERE id = ?", [uid]))?.chips || 0) : 0;

  return {
    signedIn: !!uid,
    featured,
    upcoming,
    lastRound,
    lastResults,
    chips,
    cfg: { bid: SPRINT.BID, startingStack: SPRINT.STARTING_STACK, durationMin: Math.round(SPRINT.DURATION_MS / 60000), roundsPerDay: SPRINT.ROUNDS_PER_DAY },
  };
}

const ERRORS = {
  no_round: "That round is no longer available.",
  closed: "Registration for that round has closed.",
  already_registered: "You're already registered for this round.",
  already_today: "You've already entered a Sprint today — come back tomorrow.",
  insufficient: "Not enough chips for the buy-in.",
};

export const actions = {
  register: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in to enter." });
    const fd = await request.formData();
    const roundId = String(fd.get("roundId") || "");
    const res = await register(roundId, locals.user.id);
    if (!res.ok) return fail(400, { error: ERRORS[res.error] || "Could not register." });
    return { registered: true, roundId };
  },
};
