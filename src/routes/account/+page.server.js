import { fail, redirect } from "@sveltejs/kit";
import { query, queryOne } from "$lib/server/db.js";
import {
  invalidateSession,
  promoteToAdmin,
  updateDisplayName
} from "$lib/server/auth.js";
import { SESSION_COOKIE, clearSessionCookie } from "$lib/server/cookies.js";
import {
  claimDailyBonus,
  adminAdjust,
  recentLedger,
  dailyBonusReady,
  DAILY_BONUS
} from "$lib/server/wallet.js";

const MAX_DISPLAY_NAME_LEN = 64;
const MAX_ADMIN_ADJUST = 10_000_000;

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/account/login");

  const walletRow = await queryOne(
    "SELECT chips, last_daily_bonus_at FROM user WHERE id = ?",
    [locals.user.id]
  );
  const chips = walletRow ? Number(walletRow.chips) : 0;
  const bonusReady = walletRow ? dailyBonusReady(walletRow.last_daily_bonus_at) : false;
  const ledger = await recentLedger(locals.user.id, 20);

  // v2: `hand_upload.perspective_seat_id` is gone — per-row hero seat
  // now lives on `hand_canonical.hero_seat`. Pull it from there.
  const myUploads = await query(
    `SELECT u.id, u.hand_key, u.uploaded_at, u.is_canonical,
            c.table_id, c.first_ts, c.hero_seat,
            p.name AS player_name
     FROM hand_upload u
     LEFT JOIN hand_canonical c ON c.hand_key = u.hand_key
     LEFT JOIN casino_player p ON p.id = c.player_id
     WHERE u.user_id = ?
     ORDER BY u.uploaded_at DESC
     LIMIT 100`,
    [locals.user.id]
  );

  let allUsers = null;
  if (locals.user.isAdmin) {
    allUsers = await query(
      `SELECT id, email, display_name, is_admin, created_at, chips
       FROM user ORDER BY created_at DESC`
    );
  }

  return {
    myUploads,
    allUsers,
    chips,
    bonusReady,
    dailyBonus: DAILY_BONUS,
    ledger
  };
}

export const actions = {
  logout: async ({ cookies }) => {
    const token = cookies.get(SESSION_COOKIE);
    await invalidateSession(token);
    clearSessionCookie(cookies);
    throw redirect(303, "/");
  },

  claimDailyBonus: async ({ locals }) => {
    if (!locals.user) return fail(401, { bonusError: "Sign in first." });
    const res = await claimDailyBonus(locals.user.id);
    if (!res.granted) {
      const mins = Math.max(1, Math.ceil((res.nextAt - Date.now()) / 60000));
      return fail(429, { bonusError: `Already claimed. Come back in ~${mins} min.` });
    }
    return { bonusOk: true, bonusAmount: res.amount, chips: res.balance };
  },

  // Admin: grant or claw back chips for any account. `delta` is signed.
  adjustChips: async ({ request, locals }) => {
    if (!locals.user || !locals.user.isAdmin) {
      return fail(403, { adjustError: "Admin only." });
    }
    const form = await request.formData();
    const userId = String(form.get("userId") || "");
    const delta = Number(form.get("delta"));
    if (!userId) return fail(400, { adjustError: "Pick a user." });
    if (!Number.isInteger(delta) || delta === 0) {
      return fail(400, { adjustError: "Enter a non-zero whole number (negative to remove)." });
    }
    if (Math.abs(delta) > MAX_ADMIN_ADJUST) {
      return fail(400, { adjustError: `Keep it under ${MAX_ADMIN_ADJUST.toLocaleString()} per adjustment.` });
    }
    try {
      const balance = await adminAdjust(userId, delta, locals.user.id);
      return { adjustOk: true, adjustBalance: balance };
    } catch (e) {
      if (e?.code === "INSUFFICIENT_CHIPS") {
        return fail(400, { adjustError: "That would drop the balance below zero." });
      }
      return fail(500, { adjustError: "Adjustment failed." });
    }
  },

  promote: async ({ request, locals }) => {
    if (!locals.user || !locals.user.isAdmin) {
      return fail(403, { promoteError: "Admin only." });
    }
    const form = await request.formData();
    const userId = String(form.get("userId") || "");
    if (!userId) return fail(400, { promoteError: "Pick a user." });
    await promoteToAdmin(userId);
    return { promoteOk: true };
  },

  // Update the signed-in user's display name. Empty / whitespace input
  // clears the field (display falls back to "(none)" in the UI).
  updateDisplayName: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { displayNameError: "Sign in first." });
    const form = await request.formData();
    const raw = String(form.get("displayName") || "");
    if (raw.length > MAX_DISPLAY_NAME_LEN) {
      return fail(400, {
        displayNameError: `Keep it under ${MAX_DISPLAY_NAME_LEN} characters.`
      });
    }
    const next = await updateDisplayName(locals.user.id, raw);
    // Reflect immediately in `locals.user` so the rest of this request
    // — and the page rerender — see the new name without a round trip.
    locals.user.displayName = next;
    return { displayNameOk: true, displayName: next };
  }
};
