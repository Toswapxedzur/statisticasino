import { redirect, fail } from "@sveltejs/kit";
import { queryOne } from "$lib/server/db.js";
import { activeQuestsFor, claim } from "$lib/server/quests.js";
import { listForUser } from "$lib/server/achievements.js";
import { handsPlayedByUser } from "$lib/server/poker/store.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const quests = await activeQuestsFor(locals.user.id);
  const row = await queryOne("SELECT chips, daily_streak FROM user WHERE id = ?", [locals.user.id]);
  // Achievements live here too — quests are the repeating objectives, badges the
  // one-time milestones; one progression hub.
  const handsPlayed = await handsPlayedByUser(locals.user.id).catch(() => 0);
  const achievements = await listForUser(locals.user.id, undefined, {
    handsPlayed,
    streak: row ? Number(row.daily_streak || 0) : 0
  });
  return { quests, chips: row ? Number(row.chips) : 0, achievements };
}

export const actions = {
  claim: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Sign in first." });
    const fd = await request.formData();
    const questId = String(fd.get("questId") || "");
    const res = await claim(locals.user.id, questId);
    if (!res.ok) {
      return fail(400, {
        error: res.error === "not_claimable" ? "That quest isn't ready to claim." : "Unknown quest.",
      });
    }
    return { claimedId: questId, reward: res.reward, chips: res.balance };
  },
};
