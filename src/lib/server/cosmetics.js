// Cosmetics on the server: peak wealth (what unlocks the metals), and equipping a ring / badge.
// The catalog and the drawing live in $lib/cosmetics.js (shared with the client).
//
// Wealth = wallet (`user.chips`) + chips sitting on tables (`poker_escrow.stack`). `peak_wealth` only
// ever rises, so an unlock never lapses. It is bumped after every event that can raise wealth: a
// wallet credit, a cash-out (a staked bot's winnings reach its funder), a received transfer, and each
// hand's stack sync — and once more whenever the Cosmetics page loads, as a catch-all.
import { query, execute } from "./db.js";
import { LOOKS, isLook, ownedLooks } from "../cosmetics.js";

export const SLOTS = ["ring", "badge"];

/** Raise each user's peak to their current wealth (never lowers it). Best effort: never throws. */
export async function bumpPeakWealth(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  const qs = ids.map(() => "?").join(",");
  try {
    await execute(
      `UPDATE user u LEFT JOIN (SELECT user_id, SUM(stack) AS s FROM poker_escrow WHERE user_id IN (${qs}) GROUP BY user_id) e
         ON e.user_id = u.id
       SET u.peak_wealth = GREATEST(u.peak_wealth, u.chips + COALESCE(e.s, 0))
       WHERE u.id IN (${qs})`,
      [...ids, ...ids]
    );
  } catch { /* a missed bump is caught by the next one */ }
}

/** A player's cosmetics: current + peak wealth, what they own, what they wear. */
export async function cosmeticsFor(userId) {
  await bumpPeakWealth([userId]);
  const rows = await query(
    `SELECT u.chips, u.peak_wealth, u.ring, u.badge, COALESCE((SELECT SUM(stack) FROM poker_escrow e WHERE e.user_id = u.id), 0) AS on_tables
       FROM user u WHERE u.id = ?`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  const peak = Number(r.peak_wealth), owned = ownedLooks(peak);
  const wearing = (k) => (owned.includes(k) ? k : "default");
  return { wealth: Number(r.chips) + Number(r.on_tables), peak, owned, ring: wearing(r.ring), badge: wearing(r.badge) };
}

/** Equip `look` in `slot` ("ring" | "badge"). Refuses a look the player hasn't unlocked. */
export async function equip(userId, slot, look) {
  if (!SLOTS.includes(slot)) return { error: "Unknown cosmetic slot." };
  if (!isLook(look)) return { error: "Unknown look." };
  const c = await cosmeticsFor(userId);
  if (!c) return { error: "No such player." };
  if (!c.owned.includes(look)) {
    const need = LOOKS.find((l) => l.key === look).at;
    return { error: `Unlocks at ${need.toLocaleString("en-US")} chips of wealth.` };
  }
  await execute(`UPDATE user SET ${slot} = ? WHERE id = ?`, [look, userId]);
  return { ...c, [slot]: look };
}

/** Equipped looks for many users at once (for seats, the lobby, the leaderboard): id → { ring, badge }. */
export async function looksFor(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await query(`SELECT id, ring, badge, peak_wealth FROM user WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return new Map(rows.map((r) => {
    const owned = ownedLooks(Number(r.peak_wealth));
    return [r.id, { ring: owned.includes(r.ring) ? r.ring : "default", badge: owned.includes(r.badge) ? r.badge : "default" }];
  }));
}
