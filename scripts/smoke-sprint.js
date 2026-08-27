// Headless smoke test for the River Sprint fast-fold pool: run a bots-only round
// and print the final standings. Validates the full engine path (seat across
// tables -> deal -> fold-teleport -> bust -> buzzer -> ranked standings) against
// the real LiveTable engine and real bot brains, without any browser/WS/human.
//
// Run:  set -a; source ./.env; set +a; node scripts/smoke-sprint.js
//
// Uses the local DB (bots are real user rows). Short duration + fast blinds so a
// few hands and some busts happen in a handful of seconds.

import { hub } from "../src/lib/server/poker/hub.js";
import { SprintPool } from "../src/lib/server/poker/sprint-pool.js";

const BOTS = Number(process.argv[2] || 8);
const DURATION_MS = Number(process.argv[3] || 20000);
const STACK = Number(process.argv[4] || 800);
const BB = Number(process.argv[5] || 50);

const pool = new SprintPool(hub, {
  roundId: "smoke",
  maxSeats: 4,
  startingStack: STACK,
  smallBlind: Math.floor(BB / 2),
  bigBlind: BB,
  durationMs: DURATION_MS,
});

// Light instrumentation: count hands + busts as the round runs.
let hands = 0, busts = 0;
const origOnHandEnd = pool.onHandEnd.bind(pool);
pool.onHandEnd = async (table) => { hands++; const before = [...pool.players.values()].filter((p) => p.busted).length; await origOnHandEnd(table); const after = [...pool.players.values()].filter((p) => p.busted).length; busts += after - before; };

console.log(`[smoke-sprint] running a ${BOTS}-bot pool for ${DURATION_MS}ms…`);
const keepAlive = setInterval(() => {}, 1000); // hold the event loop open across the round

try {
  const standings = await pool.run({ botCount: BOTS });
  clearInterval(keepAlive);
  console.log(`\n[smoke-sprint] final standings (${standings.length} players):`);
  for (const s of standings) {
    console.log(`  #${String(s.place).padStart(2)}  stack=${String(s.stack).padStart(5)}  ${s.bustAt ? "busted" : "alive "}  ${s.isHuman ? "human" : "bot"}  ${String(s.id).slice(0, 14)}`);
  }
  const alive = standings.filter((s) => !s.bustAt).length;
  console.log(`\n[smoke-sprint] ok — ${hands} hands played, ${alive} survivor(s), ${standings.length - alive} busted, ${hub.tables.size} pool tables remaining (should be 0).`);
  process.exit(0);
} catch (e) {
  clearInterval(keepAlive);
  console.error("[smoke-sprint] FAILED:", e?.stack || e);
  process.exit(1);
}
