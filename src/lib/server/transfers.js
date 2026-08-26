// Friend-to-friend chip transfers with an IMPLICIT anti-mule rule: only chips a
// player EARNED from games are transferable. Earned = net cash-game result
// (SUM of poker_hand_player.net) + net tournament result (prize − entry). Free
// grants (signup, daily bonus, admin) never count, and RECEIVED transfers raise
// the balance but NOT the earned pool — so received chips can't be re-forwarded.
// Transferable = clamp(earned − alreadySentOut, 0, currentBalance).
//
// The rule is invisible in normal UI (players just see their balance); the
// transferable cap surfaces only in the transfer dialog ("you can send up to X").
// Guardrails are LOOSE: friends-only, no age gate, no daily cap.

import { tx } from "./db.js";
import { applyDelta, REASON } from "./wallet.js";
import { areFriends } from "./friends.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The core anti-mule rule, isolated + pure for testing. `earned` = net game
// profit (cash + tournament), `sentOut` = chips already transferred away,
// `balance` = current wallet. Transferable = clamp(earned − sentOut, 0, balance).
export function transferableFrom(earned, sentOut, balance) {
  return clamp(earned - sentOut, 0, balance);
}

// Compute the transferable amount inside an open transaction (conn), reading the
// committed ledger + hand results. Locks the sender's row first for correctness
// under concurrent transfers.
async function computeTransferable(conn, userId, lockFirst = false) {
  const [balRows] = await conn.query(
    lockFirst ? "SELECT chips FROM user WHERE id = ? FOR UPDATE" : "SELECT chips FROM user WHERE id = ?",
    [userId]
  );
  const balance = balRows.length ? Number(balRows[0].chips) : 0;
  const [handRows] = await conn.query("SELECT COALESCE(SUM(net),0) AS n FROM poker_hand_player WHERE user_id = ?", [userId]);
  const [tnyRows] = await conn.query("SELECT COALESCE(SUM(delta),0) AS n FROM chip_ledger WHERE user_id = ? AND reason IN (?, ?)", [userId, REASON.TOURNEY_PRIZE, REASON.TOURNEY_ENTRY]);
  const [outRows] = await conn.query("SELECT COALESCE(SUM(delta),0) AS n FROM chip_ledger WHERE user_id = ? AND reason = ?", [userId, REASON.TRANSFER_SEND]);
  const earned = Number(handRows[0].n) + Number(tnyRows[0].n);
  const sentOut = -Number(outRows[0].n); // transfer_send deltas are negative
  return transferableFrom(earned, sentOut, balance);
}

// Standalone read: how much `userId` may currently send.
export async function getTransferable(userId) {
  return tx((conn) => computeTransferable(conn, userId));
}

// Send `amount` chips from `fromId` to `toId`. Atomic; enforces friends-only and
// the earned-only transferable cap. Returns { ok, fromBalance, toBalance } or
// { error }.
export async function transfer(fromId, toId, amount) {
  const amt = Math.floor(Number(amount));
  if (!fromId || !toId || fromId === toId) return { error: "bad_target" };
  if (!Number.isFinite(amt) || amt <= 0) return { error: "bad_amount" };
  if (!(await areFriends(fromId, toId))) return { error: "not_friends" };

  try {
    return await tx(async (conn) => {
      const transferable = await computeTransferable(conn, fromId, true);
      if (amt > transferable) {
        return { error: "insufficient_transferable", transferable };
      }
      const fromBalance = await applyDelta(conn, fromId, -amt, REASON.TRANSFER_SEND, toId);
      const toBalance = await applyDelta(conn, toId, amt, REASON.TRANSFER_RECV, fromId);
      return { ok: true, amount: amt, fromBalance, toBalance };
    });
  } catch (e) {
    if (e?.code === "INSUFFICIENT_CHIPS") return { error: "insufficient_balance" };
    return { error: "transfer_failed" };
  }
}
