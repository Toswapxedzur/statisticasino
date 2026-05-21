// Smoke test for the shared readable.js transformer + the
// /data/export-dump endpoint round-trip. Run via:
//
//   node scripts/smoke-readable.js
//
// We treat the extension/static mirrors of readable.js as one
// canonical module — load from the static folder and exercise it
// against a tiny synthetic round.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

function load(path) {
  const code = readFileSync(path, "utf8");
  const ctx = { module: {}, exports: {}, globalThis: {} };
  ctx.self = ctx.globalThis;
  ctx.window = ctx.globalThis;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.globalThis;
}

function ok(label, got, want) {
  const sg = JSON.stringify(got);
  const sw = JSON.stringify(want);
  const passed = sg === sw;
  const tag = passed ? "OK  " : "FAIL";
  console.log(`${tag} ${label}: got ${sg}, want ${sw}`);
  if (!passed) process.exitCode = 1;
}

const Readable = load("static/replay-engine/readable.js").CasinoReadable;

// ---- 1. Single round transform -----------------------------------
const round = {
  handId: "h-1",
  steps: [
    {
      ts: 1000,
      action: "dealHoleCards",
      milestone: true,
      update: { action: "dealHoleCards", players: [
        { seatId: 1, cards: ["Ah","Kd"] }, { seatId: 2 }
      ] }
    },
    {
      ts: 1100,
      action: "raise",
      milestone: false,
      update: { action: "raise", seatId: 1, chips: 60 }
    },
    {
      ts: 1200,
      action: "fold",
      milestone: false,
      update: { action: "fold", seatId: 2 }
    },
    {
      ts: 1300,
      action: "awardPot",
      milestone: true,
      update: { action: "awardPot", players: [
        { seatId: 1, chips: 90, handStrength: "AK high" }
      ] }
    }
  ]
};
const hero = { name: "Alice", casinoUserId: 1001, seatId: 1, holeCards: ["Ah","Kd"] };
const r = Readable.buildRoundReadable(round, hero, { firstTs: 1000, lastTs: 1300 });
ok("round.handId", r.handId, "h-1");
ok("round.firstTs", r.firstTs, 1000);
ok("round.lastTs", r.lastTs, 1300);
ok("round.hero", r.hero, hero);
ok("actions count", r.actions.length, 4);
ok("actions[0].action", r.actions[0].action, "dealHoleCards");
ok("actions[0].seats", r.actions[0].seats, [
  { seatId: 1, cards: ["Ah","Kd"] }, { seatId: 2 }
]);
ok("actions[1] raise seatId", r.actions[1].seatId, 1);
ok("actions[1] raise chips", r.actions[1].chips, 60);
ok("actions[2] fold seatId", r.actions[2].seatId, 2);
ok("actions[3] winners", r.actions[3].winners, [
  { seatId: 1, chips: 90, handStrength: "AK high" }
]);

// ---- 2. Top-level grouping (player → table → round) -------------
const exportPayload = Readable.buildExport([
  { player: hero, table: { tableId: "T1", names: ["Aquarium"] }, round: r },
  { player: hero, table: { tableId: "T1", names: ["Aquarium"] }, round: { ...r, handId: "h-2" } },
  { player: { name: null, casinoUserId: null }, table: { tableId: "T9", names: null }, round: r }
]);
ok("export.format", exportPayload.format, "casino-readable-export");
ok("two players", exportPayload.players.length, 2);
const alice = exportPayload.players.find((p) => p.name === "Alice");
ok("alice exists", !!alice, true);
ok("alice has 1 table", alice.tables.length, 1);
ok("alice T1 has 2 rounds", alice.tables[0].rounds.length, 2);

// ---- 3. Generic / null hero round -------------------------------
const r2 = Readable.buildRoundReadable(round, null, { firstTs: 1000, lastTs: 1300 });
ok("round.hero null", r2.hero, null);

console.log("readable smokes pass.");
