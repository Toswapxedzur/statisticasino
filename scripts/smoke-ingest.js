// Smoke test for the v5 ingest pipeline.
//
// v5 (2026-05-27, "Option B"): envelopes now carry in-band
// `gameVariant` / `stakesTier` / `smallBlind` / `bigBlind` fields
// (sourced from the WS `state` payload by the extension). The server
// reads these instead of parsing the lobby-name string. The synthetic
// envelopes here stamp them directly so the test exercises the
// Option B path end-to-end. A `blinds` action is still included in
// the frame slice so the sb/bb fallback path also works.
//
// v4 (2026-05-27): adds the game-variant + betting-limit filter and
// the casino_table upsert.
//
//
// Pass A — non-admin uploader. Builds five synthetic envelopes:
//
//   1. Hero = "Alice" (seat 3) at table 9001 hand "h-1"     [finished]
//   2. Hero = "Alice" (seat 3) at table 9001 hand "h-1"     [finished, dup]
//   3. Hero = "Bob"   (seat 7) at table 9001 hand "h-1"     [finished, other player]
//   4. Generic capture (no perspective) at table 9001 hand "h-2"
//   5. Hero = "Alice" (seat 3) at table 9001 hand "h-3"     [incomplete]
//
//   Asserts: 2 real players, generic rejected, incomplete rejected.
//
// Pass B — admin uploader. Re-uploads:
//
//   6. Generic capture at table 9001 hand "h-1" (overlap with Alice + Bob)
//   7. Generic capture at table 9001 hand "h-2"
//   8. Generic capture at table 9001 hand "h-2" (dup inside Generic)
//
//   Asserts: a third player "[Generic]" appears, hands 6+7 ingest
//   under it, hand 8 is collapsed as a dup, hand 6 coexists with
//   Alice's and Bob's takes on the same round.
//
// Run with: node scripts/smoke-ingest.js

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Use a hermetic schema name so the test never touches production data.
// We DROP + CREATE the database before pointing the app at it; the
// ensureMigrated() call then builds the v4 schema on the fresh DB.
const SMOKE_DB = "statisticasino_smoke";
const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});
await root.query(`DROP DATABASE IF EXISTS \`${SMOKE_DB}\``);
await root.query(`CREATE DATABASE \`${SMOKE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await root.end();
process.env.MYSQL_DATABASE = SMOKE_DB;

const { ensureMigrated, shutdown } = await import("../src/lib/server/migrate.js");
const { ingestContainer } = await import("../src/lib/server/ingest.js");
const { listPlayers } = await import("../src/lib/server/tables.js");

await ensureMigrated();

// Real-shape WebSocket frames as observed in production (DATA_FORMAT.md
// §4.2 + casinoMalwareExtension/replay.js):
//
//   * `startHand` payload:    seats[]   keyed by `id` (NOT seatId)
//   * `dealHoleCards` payload: players[] keyed by `seatId`
//
// The legacy shape (`dealHoleCards` with `seats[]`) is also accepted
// by perspective.js as a back-compat path; we exercise BOTH below.
// A blinds update is required as of v4 — stake extraction (sb/bb)
// happens at ingest and refuses to write an envelope without one.
// Seat 3 posts the small blind (1), seat 7 posts the big blind (2).
const blindsUpdate = () => ({
  action: "blinds",
  players: [
    { seatId: 3, bet: 1, deadBet: 0 },
    { seatId: 7, bet: 2, deadBet: 0 }
  ]
});

const heroFrame = (seatId, cards, handId) => ({
  ts: Date.now(),
  event: "output",
  payload: {
    handId,
    updates: [
      { action: "startHand", id: handId, dealerSeat: 1, seats: [
        { id: 3, userId: 1001, stack: 1000, state: "playing" },
        { id: 7, userId: 1002, stack: 1000, state: "playing" },
      ] },
      blindsUpdate(),
      { action: "dealHoleCards", players: [
        { seatId: 3, cards: seatId === 3 ? cards : ["X", "X"] },
        { seatId: 7, cards: seatId === 7 ? cards : ["X", "X"] }
      ] }
    ]
  }
});
const genericFrame = (handId) => ({
  ts: Date.now(),
  event: "output",
  payload: {
    handId,
    updates: [
      { action: "startHand", id: handId, seats: [
        { id: 3, userId: 1001 },
        { id: 7, userId: 1002 }
      ] },
      blindsUpdate(),
      { action: "dealHoleCards", players: [
        { seatId: 3, cards: ["X", "X"] },
        { seatId: 7, cards: ["X", "X"] }
      ] }
    ]
  }
});

function envelope({ tableId, handId, hero, cards, generic, ts, lifecycle }) {
  const frames = generic
    ? [genericFrame(handId)]
    : [heroFrame(hero, cards, handId)];
  return {
    v: 1,
    handKey: `${tableId}::${handId}`,
    handId,
    tableId,
    // v5 (Option B): the extension stamps the bare server-authoritative
    // name on every envelope, not the decorated lobby string. The
    // game/stakes/blinds fields come straight off `state.*`.
    tableNames: ["Aquarium 2"],
    gameVariant: "holdem",
    stakesTier: "low",
    smallBlind: 1,
    bigBlind: 2,
    firstTs: ts,
    lastTs: ts,
    lifecycle: lifecycle || "finished",
    frames
  };
}

const container = {
  v: 1,
  format: "casino-export",
  exportedTs: Date.now(),
  // Casino-side display names keyed by userId. The v2 ingest layer
  // uses this to resolve "seat 3 -> Alice".
  userIndex: { "1001": "Alice", "1002": "Bob" },
  hands: [
    envelope({ tableId: "9001", handId: "h-1", hero: 3, cards: ["Ah", "Kd"], ts: 1 }),
    envelope({ tableId: "9001", handId: "h-1", hero: 3, cards: ["Ah", "Kd"], ts: 2 }),  // dup
    envelope({ tableId: "9001", handId: "h-1", hero: 7, cards: ["Qs", "Qc"], ts: 3 }),  // other player
    envelope({ tableId: "9001", handId: "h-2", generic: true, ts: 4 }),                  // generic
    envelope({ tableId: "9001", handId: "h-3", hero: 3, cards: ["7h", "2d"], ts: 5,
               lifecycle: "incomplete" }),                                                // incomplete
  ]
};

// ---------------------- Pass A: non-admin uploader ------------------

const summaryA = await ingestContainer(container, null);
console.log("[A] ingest summary:", summaryA);

let pass = true;
function expect(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "OK " : "BAD"}  ${label}: got ${actual}, want ${expected}`);
  if (!ok) pass = false;
}
expect("[A] summary.received",            summaryA.received,            5);
expect("[A] summary.accepted",            summaryA.accepted,            2);
expect("[A] summary.acceptedGeneric",     summaryA.acceptedGeneric,     0);
expect("[A] summary.duplicates",          summaryA.duplicates,          1);
expect("[A] summary.rejectedGeneric",     summaryA.rejectedGeneric,     1);
expect("[A] summary.rejectedIncomplete",  summaryA.rejectedIncomplete,  1);
expect("[A] summary.errors.length",       summaryA.errors.length,       0);

const playersA = await listPlayers();
expect("[A] players.length",              playersA.length,              2);
const aliceA = playersA.find((p) => p.name === "Alice");
const bobA   = playersA.find((p) => p.name === "Bob");
expect("[A] Alice exists",        !!aliceA,                              true);
expect("[A] Bob exists",          !!bobA,                                true);
expect("[A] Alice handCount",     aliceA && aliceA.handCount,            1);
expect("[A] Bob handCount",       bobA   && bobA.handCount,              1);
expect("[A] no Generic player",   playersA.some((p) => p.name === "[Generic]"), false);

// v5: per-table metadata is populated from the envelope's in-band
// state fields (smallBlind / bigBlind / stakesTier / gameVariant)
// and from the hardcoded NL-Hold'em assumption for betting limit.
const aliceTable = aliceA && aliceA.tables[0];
expect("[A] table smallBlind",    aliceTable && aliceTable.smallBlind,   1);
expect("[A] table bigBlind",      aliceTable && aliceTable.bigBlind,     2);
expect("[A] table bettingLimit",  aliceTable && aliceTable.bettingLimit, "No Limit");
expect("[A] table stakesTier",    aliceTable && aliceTable.stakesTier,   "low");
expect("[A] table names[0]",      aliceTable && aliceTable.names[0],     "Aquarium 2");

// ---------------------- Pass B: admin uploader ----------------------
//
// Re-upload one envelope that OVERLAPS Alice/Bob's round (same
// tableId + handId) plus a fresh generic round and a duplicate of
// it. Admin-side ingest should accept all three; the duplicate
// should collapse.

const adminContainer = {
  v: 1,
  format: "casino-export",
  exportedTs: Date.now(),
  userIndex: { "1001": "Alice", "1002": "Bob" },
  hands: [
    envelope({ tableId: "9001", handId: "h-1", generic: true, ts: 100 }), // overlaps with Alice + Bob
    envelope({ tableId: "9001", handId: "h-9", generic: true, ts: 101 }), // fresh under Generic
    envelope({ tableId: "9001", handId: "h-9", generic: true, ts: 102 })  // dup inside Generic
  ]
};
const summaryB = await ingestContainer(adminContainer, null, { isAdmin: true });
console.log("[B] ingest summary:", summaryB);
expect("[B] summary.received",            summaryB.received,            3);
expect("[B] summary.accepted",            summaryB.accepted,            2);
expect("[B] summary.acceptedGeneric",     summaryB.acceptedGeneric,     2);
expect("[B] summary.duplicates",          summaryB.duplicates,          1);
expect("[B] summary.rejectedGeneric",     summaryB.rejectedGeneric,     0);
expect("[B] summary.rejectedIncomplete",  summaryB.rejectedIncomplete,  0);

const playersB = await listPlayers();
console.log("[B] players:", JSON.stringify(playersB.map((p) => ({
  name: p.name,
  handCount: p.handCount,
  tables: p.tables.map((t) => ({ tableId: t.tableId, handCount: t.handCount }))
})), null, 2));

const generic = playersB.find((p) => p.name === "[Generic]");
expect("[B] Generic player exists",       !!generic,                    true);
expect("[B] Generic handCount",           generic && generic.handCount, 2);
expect("[B] all 3 players present",       playersB.length,              3);

// Critically: Alice's row for h-1 is still there alongside the new
// Generic row for h-1 — overlap must NOT be merged.
const aliceB = playersB.find((p) => p.name === "Alice");
expect("[B] Alice still has 1 hand",      aliceB && aliceB.handCount,   1);
const genericTable = generic && generic.tables[0];
const genericH1 = genericTable && genericTable.hands.find((h) => h.handId === "h-1");
expect("[B] Generic h-1 has null hero",   genericH1 && genericH1.heroSeat, null);

await shutdown();
// Drop the smoke DB on the way out so RDS doesn't accumulate cruft.
const cleanup = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});
await cleanup.query(`DROP DATABASE IF EXISTS \`${SMOKE_DB}\``);
await cleanup.end();
process.exit(pass ? 0 : 1);
