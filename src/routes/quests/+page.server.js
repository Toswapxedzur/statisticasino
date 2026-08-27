import { redirect, fail } from "@sveltejs/kit";
import { queryOne } from "$lib/server/db.js";
import { activeQuestsFor, claim } from "$lib/server/quests.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");
  const quests = await activeQuestsFor(locals.user.id);
  const row = await queryOne("SELECT chips FROM user WHERE id = ?", [locals.user.id]);
  return { quests, chips: row ? Number(row.chips) : 0 };
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
