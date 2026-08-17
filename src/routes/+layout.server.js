// Top-level layout server load: exposes the current user (+ chips wallet)
// and a couple of global counts for the topbar.

import { queryOne } from "$lib/server/db.js";
import { dailyBonusReady } from "$lib/server/wallet.js";

export async function load({ locals }) {
  const handRow = await queryOne("SELECT COUNT(*) AS n FROM hand_canonical");

  let chips = null;
  let bonusReady = false;
  if (locals.user) {
    const u = await queryOne(
      "SELECT chips, last_daily_bonus_at FROM user WHERE id = ?",
      [locals.user.id]
    );
    chips = u ? Number(u.chips) : 0;
    bonusReady = u ? dailyBonusReady(u.last_daily_bonus_at) : false;
  }

  return {
    user: locals.user,
    chips,
    bonusReady,
    handCount: handRow ? Number(handRow.n) : 0
  };
}
