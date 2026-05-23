// Smoke test for the bulk .casinodump export endpoint:
//
//   1. Stand up a fresh sqlite db and ingest a couple of finished hands.
//   2. Call loadHandsForExport for the resulting handKeys.
//   3. Re-build the container the way +server.js does and round-trip
//      through gzip + base64 decode, checking every field is preserved.
//
//   node scripts/smoke-export-dump.js

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import mysql from "mysql2/promise";

function ok(label, got, want) {
  const sg = JSON.stringify(got);
  const sw = JSON.stringify(want);
  const pass = sg === sw;
  console.log(`${pass ? "OK  " : "FAIL"} ${label}: got ${sg}, want ${sw}`);
  if (!pass) process.exitCode = 1;
}

// Pull MYSQL_* from .env (no .env.example fallback — smoke is dev-only).
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

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
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;

const { ensureMigrated, shutdown } = await import("../src/lib/server/migrate.js");
const { ingestContainer } = await import("../src/lib/server/ingest.js");
const { loadHandsForExport } = await import("../src/lib/server/tables.js");

await ensureMigrated();

// Minimal finished-hand frames: startHand → dealHoleCards →
// awardPot → finishHand. Hero seat 3, userId 1001 ("Alice" via
// userIndex). Mirrors smoke-ingest.js, scaled down.
function frames(handId) {
  return [{
    ts: 1000,
    event: "output",
    payload: {
      handId,
      updates: [
        { action: "startHand", id: handId, dealerSeat: 1, seats: [
          { id: 3, userId: 1001, stack: 1000, state: "playing" }
        ] },
        { action: "dealHoleCards", players: [
          { seatId: 3, cards: ["Ah", "Kd"] }
        ] }
      ]
    }
  }, {
    ts: 1100,
    event: "output",
    payload: {
      handId,
      updates: [{ action: "awardPot", players: [{ seatId: 3, chips: 100 }] }]
    }
  }, {
    ts: 1200,
    event: "output",
    payload: { handId, updates: [{ action: "finishHand" }] }
  }];
}

function envelope(handId, tableId) {
  return {
    v: 1,
    handKey: `${tableId}::${handId}`,
    handId,
    tableId,
    tableNames: [`Table ${tableId}`],
    firstTs: 1000,
    lastTs: 1200,
    lifecycle: "finished",
    frames: frames(handId)
  };
}

const container = {
  v: 1, format: "casino-export", exportedTs: Date.now(),
  userIndex: { "1001": "Alice" },
  hands: [
    envelope("h-1", "T1"),
    envelope("h-2", "T1")
  ]
};
const summary = await ingestContainer(container, null);
ok("ingest acceptedNew", summary.accepted, 2);

const handKeys = await import("../src/lib/server/tables.js")
  .then(({ listPlayers }) => listPlayers())
  .then((players) => {
    const out = [];
    for (const p of players) for (const t of p.tables) for (const h of t.hands) {
      out.push(h.handKey);
    }
    return out;
  });
ok("ingest produced 2 handKeys", handKeys.length, 2);

const rows = await loadHandsForExport(handKeys);
ok("loaded both rows", rows.length, 2);
ok("row 0 has frames blob", typeof rows[0].framesBlob, "object");

// Build container the same way +server.js does, then round-trip it.
const envelopes = rows.map((r) => {
  const fr = JSON.parse(gunzipSync(r.framesBlob).toString("utf8"));
  return {
    v: 1, handKey: r.handKey, handId: r.handId, tableId: r.tableId,
    tableNames: r.tableNames || null,
    pageUrl: null, pageTitle: null, handIndex: 0,
    firstTs: r.firstTs, lastTs: r.lastTs,
    actionCount: null, frameCount: fr.length,
    lifecycle: "finished",
    frames: fr,
    contentHash: r.contentHash || null
  };
});
const userIndex = {};
for (const r of rows) {
  if (r.player.casinoUserId != null && r.player.name) {
    userIndex[String(r.player.casinoUserId)] = r.player.name;
  }
}
const container2 = {
  v: 1, format: "casino-export", exportedTs: Date.now(),
  handCount: envelopes.length, userIndex, hands: envelopes
};
const gz = gzipSync(Buffer.from(JSON.stringify(container2)));
const b64 = gz.toString("base64");

const decoded = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
ok("decoded format", decoded.format, "casino-export");
ok("decoded handCount", decoded.handCount, 2);
ok("decoded[0].tableId", decoded.hands[0].tableId, "T1");
ok("decoded[0].lifecycle", decoded.hands[0].lifecycle, "finished");
ok("decoded[0] frame count", decoded.hands[0].frames.length, 3);
ok("decoded[0] tableNames", decoded.hands[0].tableNames, ["Table T1"]);
// userIndex should carry "1001 → Alice" from the ingested player row
const reverseLookup = Object.values(decoded.userIndex);
ok("userIndex has Alice", reverseLookup.includes("Alice"), true);

// Re-ingest the round-tripped container into the SAME db: should be
// recognized as duplicates of the existing two hands (no new rows).
const reSummary = await ingestContainer(container2, null);
ok("re-ingest duplicates", reSummary.duplicates, 2);
ok("re-ingest no new", reSummary.accepted, 0);

await shutdown();
const cleanup = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});
await cleanup.query(`DROP DATABASE IF EXISTS \`${SMOKE_DB}\``);
await cleanup.end();
console.log("export-dump smokes pass.");
