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

// Resolve a set of user ids to display info (id -> { name, email }).
export async function usersByIds(userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT id, display_name, email FROM user WHERE id IN (${placeholders})`,
    userIds
  );
  return new Map(rows.map((r) => [r.id, { name: r.display_name || r.email, email: r.email }]));
}

// Look up a user by a typed "handle" — exact email, or exact display name. Bots
// (reserved .invalid domain) are never resolvable this way. Returns { id, name }
// or null.
export async function findUserByHandle(handle) {
  const h = String(handle || "").trim();
  if (!h) return null;
  const row = await queryOne(
    "SELECT id, display_name, email FROM user "
    + "WHERE (email = ? OR display_name = ?) AND email NOT LIKE '%@bot.bluffingvalley.invalid' LIMIT 1",
    [h, h]
  );
  return row ? { id: row.id, name: row.display_name || row.email } : null;
}

// Name search for the Social "find friends" flow. Prefix + substring match on the
// display name, bots and the caller excluded. Returns [{ id, name }].
export async function searchUsers(q, limit = 20, excludeId = null) {
  const s = String(q || "").trim();
  if (s.length < 2) return [];
  const like = `%${s.replace(/[%_]/g, "\\$&")}%`;
  const rows = await query(
    "SELECT id, display_name, email FROM user "
    + "WHERE display_name LIKE ? AND email NOT LIKE '%@bot.bluffingvalley.invalid' "
    + (excludeId ? "AND id <> ? " : "")
    + "ORDER BY CASE WHEN display_name = ? THEN 0 ELSE 1 END, display_name ASC LIMIT ?",
    excludeId ? [like, excludeId, s, limit] : [like, s, limit]
  );
  return rows.map((r) => ({ id: r.id, name: r.display_name || r.email }));
}

// Top players by wallet chips, for the lobby leaderboard. Bots are real user
// rows (so they buy in through escrow like anyone) but live under a reserved
// `.invalid` email domain — exclude them so they don't crowd the human board.
export async function leaderboard(limit = 10) {
  const rows = await query(
    `SELECT id, COALESCE(NULLIF(display_name, ''), email) AS name, chips, avatar_media_id
       FROM user
      WHERE email NOT LIKE '%@bot.bluffingvalley.invalid'
      ORDER BY chips DESC, name ASC
      LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, chips: r.chips, avatarMediaId: r.avatar_media_id || null }));
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
      // state_json (the full engine state) is no longer written: nothing reads
      // it and the match_replay recording supersedes it. Old rows get pruned
      // by the archive job (scripts/replay-archive.mjs prune-legacy).
      null
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

// ------------------------------------------------------------ match replays

// Persist one recorded match (any game mode) + its participants. `r` is
// { mode, variant, context, tableId, tableName, handNo, startedAt, endedAt,
//   potTotal, replay (object), players:[{userId,seat,displayName,role,net}] }.
// Called by the table loops after settlement; callers swallow errors so a DB
// hiccup can never break gameplay.
export async function persistReplay(r) {
  const replayId = id();
  await execute(
    `INSERT INTO match_replay
       (id, mode, variant, context, table_id, table_name, hand_no,
        started_at, ended_at, pot_total, replay_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      replayId, r.mode, r.variant ?? null, r.context ?? "cash",
      r.tableId ?? null, r.tableName ?? null, r.handNo ?? null,
      r.startedAt, r.endedAt, r.potTotal ?? 0, JSON.stringify(r.replay)
    ]
  );
  for (const p of r.players || []) {
    await execute(
      `INSERT INTO match_replay_player
         (id, replay_id, user_id, seat, display_name, role, net, mode, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id(), replayId, p.userId ?? null, p.seat, p.displayName ?? null,
       p.role ?? "player", p.net ?? 0, r.mode, r.endedAt]
    );
  }
  return replayId;
}

// One replay with its participants (viewer-side redaction happens in the route).
export async function replayById(replayId) {
  const row = await queryOne("SELECT * FROM match_replay WHERE id = ?", [replayId]);
  if (!row) return null;
  const players = await query(
    "SELECT user_id, seat, display_name, role, net FROM match_replay_player WHERE replay_id = ? ORDER BY seat",
    [replayId]
  );
  return { ...row, players };
}

// A user's recent recorded matches (their own history page, or a public
// profile filtered by the exposure window). `sinceMs` bounds ended_at.
export async function recentReplaysForUser(userId, { sinceMs = 0, mode = null, limit = 50, before = null } = {}) {
  const args = [userId, sinceMs];
  let where = "mrp.user_id = ? AND mrp.ended_at >= ?";
  if (mode) { where += " AND mrp.mode = ?"; args.push(mode); }
  if (before) { where += " AND mrp.ended_at < ?"; args.push(before); }
  args.push(limit);
  return query(
    `SELECT mr.id, mr.mode, mr.variant, mr.context, mr.table_name, mr.hand_no,
            mr.started_at, mr.ended_at, mr.pot_total, mrp.seat, mrp.net, mrp.role
       FROM match_replay_player mrp
       JOIN match_replay mr ON mr.id = mrp.replay_id
      WHERE ${where}
      ORDER BY mrp.ended_at DESC
      LIMIT ?`,
    args
  );
}

// Lifetime count of hands a user has been dealt into (for milestone achievements).
export async function handsPlayedByUser(userId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM poker_hand_player WHERE user_id = ?",
    [userId]
  );
  return row ? Number(row.n) : 0;
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
