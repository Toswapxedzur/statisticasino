// Poker persistence — DB access for our live tables + completed-hand
// history. Kept separate from the in-memory hub so the hub has no SQL and
// the store has no game logic.
//
// Plain-node-ESM clean (relative imports only) so it can run inside the
// custom prod server.js AND under Vite dev.

import { randomBytes } from "node:crypto";
import { query, queryOne, execute } from "../db.js";

function id() {
  return randomBytes(16).toString("hex");
}

// ------------------------------------------------------------- tables

export async function listActiveTables() {
  return query(
    `SELECT id, name, variant, max_seats, small_blind, big_blind,
            min_buyin, max_buyin, sort_order
       FROM poker_table
      WHERE is_active = 1
      ORDER BY sort_order ASC, big_blind ASC, name ASC`
  );
}

export async function getTable(tableId) {
  return queryOne("SELECT * FROM poker_table WHERE id = ?", [tableId]);
}

// v11: create a player-made ephemeral table row. Returns its id.
export async function createTableRow(cfg, createdBy) {
  const tid = id();
  await execute(
    `INSERT INTO poker_table
       (id, name, variant, max_seats, small_blind, big_blind, min_buyin,
        max_buyin, is_active, sort_order, created_at, created_by,
        is_ephemeral, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 1, NULL)`,
    [tid, cfg.name, cfg.variant || "holdem", cfg.maxSeats, cfg.smallBlind, cfg.bigBlind,
     cfg.minBuyin, cfg.maxBuyin, Date.now(), createdBy ?? null]
  );
  return tid;
}

// v11: mark an ephemeral table closed once its live instance is torn down.
// The row is kept for poker_hand FK integrity.
export async function closeTableRow(tableId) {
  await execute(
    "UPDATE poker_table SET is_active = 0, closed_at = ? WHERE id = ?",
    [Date.now(), tableId]
  );
}

// Wallet balances for a batch of online users (for lobby presence).
export async function chipsForUsers(userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT id, chips FROM user WHERE id IN (${placeholders})`,
    userIds
  );
  return new Map(rows.map((r) => [r.id, Number(r.chips)]));
}

// Top players by wallet chips, for the lobby leaderboard. Bots are real user
// rows (so they buy in through escrow like anyone) but live under a reserved
// `.invalid` email domain — exclude them so they don't crowd the human board.
export async function leaderboard(limit = 10) {
  return query(
    `SELECT COALESCE(NULLIF(display_name, ''), email) AS name, chips
       FROM user
      WHERE email NOT LIKE '%@bot.riverside.invalid'
      ORDER BY chips DESC, name ASC
      LIMIT ?`,
    [limit]
  );
}

// Insert a starter set of Hold'em tables the first time the room boots
// with an empty poker_table. Idempotent: does nothing if any table
// already exists. Blinds/buy-ins span a few levels so the lobby isn't
// empty and there's something for every stack size.
export async function seedDefaultTablesIfEmpty() {
  const [{ n }] = await query("SELECT COUNT(*) AS n FROM poker_table");
  if (Number(n) > 0) return { seeded: 0 };

  const now = Date.now();
  // name, seats, sb, bb, minBuyin(20bb), maxBuyin(100bb), sort
  const defaults = [
    ["Kiddie Pool", 6, 1, 2, 40, 200, 10],
    ["Duck Pond", 9, 1, 2, 40, 200, 20],
    ["Riverbank", 9, 2, 4, 80, 400, 30],
    ["The Deep End", 6, 5, 10, 200, 1000, 40],
    ["High Roller", 6, 25, 50, 1000, 5000, 50]
  ];
  for (const [name, seats, sb, bb, minB, maxB, sort] of defaults) {
    await execute(
      `INSERT INTO poker_table
         (id, name, variant, max_seats, small_blind, big_blind,
          min_buyin, max_buyin, is_active, sort_order, created_at)
       VALUES (?, ?, 'holdem', ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id(), name, seats, sb, bb, minB, maxB, sort, now]
    );
  }
  return { seeded: defaults.length };
}

// ------------------------------------------------------------- hand history

// The next per-table hand number (1-based). Cheap MAX+1; hands are
// written one at a time by a single table loop so there's no race.
export async function nextHandNo(tableId) {
  const row = await queryOne(
    "SELECT COALESCE(MAX(hand_no), 0) AS m FROM poker_hand WHERE table_id = ?",
    [tableId]
  );
  return Number(row?.m || 0) + 1;
}

// Persist a completed hand + its per-seat outcomes. `seats` is
// [{ userId, seat, displayName, holeCards, net }]. Called by the table
// loop after payouts settle.
export async function persistHand(hand) {
  const handId = id();
  await execute(
    `INSERT INTO poker_hand
       (id, table_id, hand_no, button_seat, board_json, pot_total,
        started_at, ended_at, state_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      handId,
      hand.tableId,
      hand.handNo,
      hand.buttonSeat ?? null,
      hand.board ? JSON.stringify(hand.board) : null,
      hand.potTotal ?? 0,
      hand.startedAt,
      hand.endedAt,
      hand.stateJson ?? null
    ]
  );
  for (const s of hand.seats || []) {
    await execute(
      `INSERT INTO poker_hand_player
         (id, hand_id, user_id, seat, display_name, hole_cards, net)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id(), handId, s.userId ?? null, s.seat, s.displayName ?? null,
       s.holeCards ? s.holeCards.join("") : null, s.net ?? 0]
    );
  }
  return handId;
}

// Recent hands a user played, for their history page.
export async function recentHandsForUser(userId, limit = 25) {
  return query(
    `SELECT h.id, h.table_id, h.hand_no, h.board_json, h.pot_total,
            h.ended_at, php.net, php.hole_cards, php.seat,
            t.name AS table_name
       FROM poker_hand_player php
       JOIN poker_hand h ON h.id = php.hand_id
       JOIN poker_table t ON t.id = h.table_id
      WHERE php.user_id = ?
      ORDER BY h.ended_at DESC
      LIMIT ?`,
    [userId, limit]
  );
}
