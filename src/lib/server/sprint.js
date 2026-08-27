// River Sprint — round lifecycle & persistence. Sits on the pure economics in
// sprint-core.js and the live pool engine in poker/sprint-pool.js. This module
// owns the DB side: scheduling rounds, registering humans (bid + one-per-day),
// and finishing a round (rank → pool → top-heavy payout → event badges/quests).
//
// DB + wallet are injectable so the lifecycle is unit-testable without MySQL,
// matching quests.js / achievements.js.

import { randomBytes } from "node:crypto";
import * as realDb from "./db.js";
import * as realWallet from "./wallet.js";
import { REASON } from "./wallet.js";
import { unlockAndReward } from "./achievements.js";
import { recordEvent as recordQuestEvent } from "./quests.js";
import {
  SPRINT, dayKey, prizePool, payoutTable, rankStandings, sprintBadges,
} from "./sprint-core.js";

function newId() { return randomBytes(16).toString("hex"); }

// ------------------------------------------------------------- scheduling

// Create a scheduled round. Returns its id.
export async function createRound(opts = {}, db = realDb) {
  const {
    scheduledAt = Date.now(), bid = SPRINT.BID, startingStack = SPRINT.STARTING_STACK,
    durationMs = SPRINT.DURATION_MS, faucetBps = SPRINT.FAUCET_BPS,
  } = opts;
  const id = newId();
  await db.execute(
    `INSERT INTO sprint_round
       (id, status, scheduled_at, bid, starting_stack, duration_ms, faucet_bps, entrants, prize_pool, created_at)
     VALUES (?, 'scheduled', ?, ?, ?, ?, ?, 0, 0, ?)`,
    [id, scheduledAt, bid, startingStack, durationMs, faucetBps, Date.now()]
  );
  return id;
}

export async function setStatus(roundId, status, db = realDb, extra = {}) {
  const sets = ["status = ?"]; const params = [status];
  if (extra.startedAt != null) { sets.push("started_at = ?"); params.push(extra.startedAt); }
  if (extra.endedAt != null) { sets.push("ended_at = ?"); params.push(extra.endedAt); }
  params.push(roundId);
  await db.execute(`UPDATE sprint_round SET ${sets.join(", ")} WHERE id = ?`, params);
}

// ------------------------------------------------------------- registration

// Register a human for a round. Enforces one-entry-per-day via the UNIQUE
// (user_id, day_key) index, then debits the bid. Saga: claim the daily slot
// first (the UNIQUE guard is the lock), then debit; roll the slot back if the
// debit fails so the player isn't blocked for the day by a failed payment.
export async function register(roundId, userId, db = realDb, wallet = realWallet, at = Date.now()) {
  const round = (await db.query("SELECT id, status, bid FROM sprint_round WHERE id = ?", [roundId]))[0];
  if (!round) return { ok: false, error: "no_round" };
  if (round.status !== "scheduled" && round.status !== "registering") return { ok: false, error: "closed" };

  const dk = dayKey(at);
  try {
    await db.execute(
      "INSERT INTO sprint_entry (round_id, user_id, day_key, bid_paid, created_at) VALUES (?, ?, ?, ?, ?)",
      [roundId, userId, dk, round.bid, at]
    );
  } catch (e) {
    if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
      const mine = await db.query("SELECT round_id FROM sprint_entry WHERE user_id = ? AND day_key = ?", [userId, dk]);
      const inThisRound = mine.some((m) => m.round_id === roundId);
      return { ok: false, error: inThisRound ? "already_registered" : "already_today" };
    }
    throw e;
  }

  try {
    await wallet.debit(userId, round.bid, REASON.SPRINT_BID, `sprint:${roundId}`);
  } catch (e) {
    await db.execute("DELETE FROM sprint_entry WHERE round_id = ? AND user_id = ?", [roundId, userId]);
    if (e && e.code === "INSUFFICIENT_CHIPS") return { ok: false, error: "insufficient" };
    throw e;
  }

  await db.execute("UPDATE sprint_round SET entrants = entrants + 1 WHERE id = ?", [roundId]);
  try { await recordQuestEvent(userId, "sprint_enter", 1, db); } catch { /* best-effort */ }
  return { ok: true, bid: round.bid };
}

// Refund + drop a human's registration (used when a scheduled round is canceled).
export async function refundEntry(roundId, userId, bid, db = realDb, wallet = realWallet) {
  const res = await db.execute("DELETE FROM sprint_entry WHERE round_id = ? AND user_id = ?", [roundId, userId]);
  if ((res.affectedRows ?? 0) > 0 && bid > 0) {
    try { await wallet.credit(userId, bid, REASON.SPRINT_BID, `refund:${roundId}`); } catch { /* ledger gap visible */ }
  }
}

// ------------------------------------------------------------- finish

// Finish a live round. `standings` is the full field as
// [{ id, stack, bustAt, isHuman }]. Bots are ranked (they occupy places) but are
// neither persisted nor paid — a bot at a paid place simply forfeits, keeping the
// realized faucet at or below its cap. Humans get final_stack/place/prize, the
// top ~15% are paid a top-heavy share of the pool, and event badges + the
// sprint_cash quest fire for cashers.
export async function finishRound(roundId, standings, db = realDb, wallet = realWallet, at = Date.now()) {
  const round = (await db.query("SELECT id, status, faucet_bps FROM sprint_round WHERE id = ?", [roundId]))[0];
  if (!round) return { ok: false, error: "no_round" };
  if (round.status === "done") return { ok: false, error: "already_done" };

  const ranked = rankStandings(standings);
  const field = ranked.length;
  const bidRow = (await db.query("SELECT COALESCE(SUM(bid_paid),0) AS bids FROM sprint_entry WHERE round_id = ?", [roundId]))[0];
  const totalBids = Number(bidRow?.bids || 0);
  const pool = prizePool(totalBids, round.faucet_bps ?? SPRINT.FAUCET_BPS);
  const prizes = payoutTable(pool, field, SPRINT.PAID_FRACTION);
  const paidPlaces = prizes.length;

  const results = [];
  for (const p of ranked) {
    if (!p.isHuman) continue;
    const prize = p.place <= paidPlaces ? prizes[p.place - 1] : 0;
    await db.execute(
      "UPDATE sprint_entry SET final_stack = ?, place = ?, prize = ? WHERE round_id = ? AND user_id = ?",
      [p.stack || 0, p.place, prize, roundId, p.id]
    );
    if (prize > 0) {
      try { await wallet.credit(p.id, prize, REASON.SPRINT_PRIZE, `sprint:${roundId}`); } catch { /* ledger gap visible */ }
      try { await recordQuestEvent(p.id, "sprint_cash", 1, db); } catch { /* best-effort */ }
    }
    const badges = sprintBadges({ place: p.place, paidPlaces });
    if (badges.length) { try { await unlockAndReward(p.id, badges, db, wallet); } catch { /* best-effort */ } }
    results.push({ userId: p.id, place: p.place, prize, stack: p.stack || 0 });
  }

  await db.execute(
    "UPDATE sprint_round SET status = 'done', prize_pool = ?, ended_at = ? WHERE id = ?",
    [pool, at, roundId]
  );
  return { ok: true, pool, paidPlaces, field, results };
}

// ------------------------------------------------------------- reads (UI)

// The next few rounds a player can look at / register for.
export async function nextRounds(limit = 4, db = realDb) {
  return db.query(
    "SELECT * FROM sprint_round WHERE status IN ('scheduled','registering','live') ORDER BY scheduled_at ASC LIMIT ?",
    [limit]
  );
}

// A round annotated with this viewer's state (already in it? already played today?).
export async function roundView(roundId, userId, db = realDb, at = Date.now()) {
  const r = (await db.query("SELECT * FROM sprint_round WHERE id = ?", [roundId]))[0];
  if (!r) return null;
  let entered = false, playedToday = false;
  if (userId) {
    entered = (await db.query("SELECT 1 FROM sprint_entry WHERE round_id = ? AND user_id = ?", [roundId, userId])).length > 0;
    playedToday = (await db.query("SELECT 1 FROM sprint_entry WHERE user_id = ? AND day_key = ?", [userId, dayKey(at)])).length > 0;
  }
  return { ...r, entered, playedToday };
}

// Rounds whose start time has arrived but haven't run yet (scheduler drives these).
export async function roundsToStart(now, db = realDb) {
  return db.query(
    "SELECT * FROM sprint_round WHERE status IN ('scheduled','registering') AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    [now]
  );
}

// Is there already a round scheduled for this exact timeslot? (dedup on creation.)
export async function findRoundAt(scheduledAt, db = realDb) {
  return (await db.query("SELECT id FROM sprint_round WHERE scheduled_at = ? LIMIT 1", [scheduledAt]))[0] || null;
}

// Cancel a round and refund every human entrant (used when a slot has no players).
export async function cancelRound(roundId, db = realDb, wallet = realWallet) {
  const entries = await db.query("SELECT user_id, bid_paid FROM sprint_entry WHERE round_id = ?", [roundId]);
  for (const e of entries) await refundEntry(roundId, e.user_id, Number(e.bid_paid), db, wallet);
  await db.execute("UPDATE sprint_round SET status = 'canceled', ended_at = ? WHERE id = ?", [Date.now(), roundId]);
}

// Finished-round leaderboard (placed humans, best first).
export async function roundResults(roundId, limit = 25, db = realDb) {
  return db.query(
    `SELECT e.user_id, e.place, e.prize, e.final_stack,
            COALESCE(NULLIF(u.display_name, ''), u.email) AS name, u.avatar_media_id
       FROM sprint_entry e JOIN user u ON u.id = e.user_id
      WHERE e.round_id = ? AND e.place IS NOT NULL
      ORDER BY e.place ASC LIMIT ?`,
    [roundId, limit]
  );
}
