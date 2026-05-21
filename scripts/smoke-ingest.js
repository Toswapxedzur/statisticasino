// Smoke test for the v2 ingest pipeline.
//
// Builds five synthetic hand envelopes:
//
//   1. Hero = "Alice" (seat 3) at table 9001 hand "h-1"     [finished]
//   2. Hero = "Alice" (seat 3) at table 9001 hand "h-1"     [finished, dup]
//   3. Hero = "Bob"   (seat 7) at table 9001 hand "h-1"     [finished, other player]
//   4. Generic capture (no perspective) at table 9001 hand "h-2"
//   5. Hero = "Alice" (seat 3) at table 9001 hand "h-3"     [incomplete]
//
// Then asserts the tree has 2 players (Alice, Bob), each with 1 hand
// at table 9001, the generic capture was rejected, and the incomplete
// hand was rejected by the server-side defence-in-depth check.
//
// Run with: node scripts/smoke-ingest.js

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Use a throwaway DB so the test is hermetic.
const SMOKE_DB = resolve(process.cwd(), "smoke-ingest.sqlite");
process.env.DATABASE_PATH = SMOKE_DB;
if (existsSync(SMOKE_DB)) unlinkSync(SMOKE_DB);

const { ensureMigrated } = await import("../src/lib/server/migrate.js");
const { ingestContainer } = await import("../src/lib/server/ingest.js");
const { listPlayers } = await import("../src/lib/server/tables.js");

await ensureMigrated();

const heroFrame = (seatId, cards, handId) => ({
  ts: Date.now(),
  event: "output",
  payload: {
    handId,
    updates: [
      // seats[] gives us seatId -> userId for username resolution
      { action: "startHand", seats: [
        { seatId: 3, userId: 1001 },
        { seatId: 7, userId: 1002 },
      ] },
      { action: "dealHoleCards", seats: [
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
      { action: "dealHoleCards", seats: [
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
    tableNames: ["Aquarium 2"],
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

const summary = await ingestContainer(container, null);
console.log("ingest summary:", summary);

const players = await listPlayers();
console.log("players:", JSON.stringify(players.map((p) => ({
  name: p.name,
  handCount: p.handCount,
  tables: p.tables.map((t) => ({ tableId: t.tableId, handCount: t.handCount, hands: t.hands.length }))
})), null, 2));

let pass = true;
function expect(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "OK " : "BAD"}  ${label}: got ${actual}, want ${expected}`);
  if (!ok) pass = false;
}
expect("summary.received",            summary.received,            5);
expect("summary.accepted",            summary.accepted,            2);
expect("summary.duplicates",          summary.duplicates,          1);
expect("summary.rejectedGeneric",     summary.rejectedGeneric,     1);
expect("summary.rejectedIncomplete",  summary.rejectedIncomplete,  1);
expect("summary.errors.length",       summary.errors.length,       0);
expect("players.length",              players.length,              2);
const alice = players.find((p) => p.name === "Alice");
const bob   = players.find((p) => p.name === "Bob");
expect("Alice exists",  !!alice,                            true);
expect("Bob exists",    !!bob,                              true);
expect("Alice handCount", alice && alice.handCount,         1);
expect("Bob handCount",   bob   && bob.handCount,           1);

if (existsSync(SMOKE_DB)) unlinkSync(SMOKE_DB);
process.exit(pass ? 0 : 1);
