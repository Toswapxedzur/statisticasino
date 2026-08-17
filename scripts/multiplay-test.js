// Multi-user concurrency test / live demo. Signs in N throwaway accounts
// over separate WebSocket connections; some CREATE rooms, others QUICK
// PLAY into them; all auto-play. Runs several concurrent games across
// multiple tables, then drains (everyone stands) and asserts global chip
// conservation (every user's wallet returns to its starting balance).
//
// LOCAL DEV ONLY. Usage: node scripts/multiplay-test.js [users=6] [seconds=40]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!/localhost|127\.0\.0\.1/.test(process.env.MYSQL_HOST || "")) {
  console.error("REFUSING: not a local DB."); process.exit(1);
}

const N = Number(process.argv[2] || 6);
const SECONDS = Number(process.argv[3] || 40);
const START = 10000;
const PORT = process.env.PORT_WS || 5273;

const { execute, query, closePool } = await import("../src/lib/server/db.js");
const { createSession } = await import("../src/lib/server/auth.js");
const { C2S, S2C, encode, decode } = await import("../src/lib/poker/protocol.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a) => a[Math.floor(Math.random() * a.length)];

// Varied stakes for the room creators.
const STAKES = [
  { smallBlind: 1, bigBlind: 2, minBuyin: 40, maxBuyin: 200 },
  { smallBlind: 2, bigBlind: 4, minBuyin: 80, maxBuyin: 400 },
  { smallBlind: 5, bigBlind: 10, minBuyin: 200, maxBuyin: 1000 }
];

// ---- provision throwaway users ----
const users = [];
for (let i = 0; i < N; i++) {
  const id = `mplay-${i}-${randomBytes(4).toString("hex")}`;
  await execute(
    "INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at, chips) VALUES (?,?,?,?,0,?,?)",
    [id, `${id}@ex.test`, "x", `Player${i}`, Date.now(), START]
  );
  const { token } = await createSession(id);
  users.push({ id, name: `Player${i}`, token, ws: null, table: null, leaving: false, seatedEver: false });
}

const tablesSeen = new Set();
let handResults = 0;
let errors = 0;

function pickAction(actions) {
  const has = (t) => actions.find((a) => a.type === t);
  const r = Math.random();
  if (r < 0.12 && has("raise")) { const a = has("raise"); return { type: "raise", amount: a.min }; }
  if (r < 0.18 && has("bet")) { const a = has("bet"); return { type: "bet", amount: a.min }; }
  if (has("check")) return { type: "check" };
  if (has("call")) return { type: "call" };
  return { type: "fold" };
}

function connect(u, role, idx) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { headers: { Cookie: `casino_session=${u.token}` } });
  u.ws = ws;
  ws.on("open", () => {
    ws.send(encode(C2S.HELLO));
    if (role === "create") {
      const s = STAKES[idx % STAKES.length];
      setTimeout(() => ws.send(encode(C2S.TABLE_CREATE, { ...s, maxSeats: 6, buyin: s.maxBuyin })), 300);
    } else {
      // Let creators register their tables first, then match in.
      setTimeout(() => ws.send(encode(C2S.QUICK_PLAY, {})), 2500);
    }
  });
  ws.on("message", (data) => {
    const msg = decode(data.toString("utf8"));
    if (!msg) return;
    if (msg.t === S2C.ERROR) { errors++; if (!/not your turn|closed/i.test(msg.msg || "")) console.log(`  ${u.name} ERR: ${msg.msg}`); }
    if (msg.t === S2C.TABLE_CREATED) {
      u.table = msg.tableId; u.seatedEver = true; tablesSeen.add(msg.tableId);
      ws.send(encode(C2S.TABLE_JOIN, { tableId: msg.tableId }));
    }
    if (msg.t === S2C.TABLE_TURN) {
      const act = u.leaving ? { type: pickAction(msg.actions).type === "check" ? "check" : "fold" } : pickAction(msg.actions);
      setTimeout(() => { try { ws.send(encode(C2S.TABLE_ACTION, { tableId: u.table, action: act })); } catch {} }, u.leaving ? 60 : 500);
    }
    if (msg.t === S2C.TABLE_STATE && msg.table?.result) handResults++;
  });
  ws.on("error", () => {});
}

console.log(`[multiplay] ${N} users, ${SECONDS}s. Creators + quick-play joiners...`);
users.forEach((u, i) => connect(u, i % 2 === 0 ? "create" : "quick", Math.floor(i / 2)));

// ---- run ----
await sleep(SECONDS * 1000);

// ---- drain: everyone stands, folds out any live hand, then leaves ----
console.log(`[multiplay] draining (${tablesSeen.size} tables seen, ${handResults} hand-results so far)...`);
for (const u of users) { u.leaving = true; if (u.table) { try { u.ws.send(encode(C2S.TABLE_STAND, { tableId: u.table })); } catch {} } }

// Poll the wallet total until every stack has been cashed back (or timeout).
const idsList = users.map((u) => u.id);
const placeholders = idsList.map(() => "?").join(",");
let conserved = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const [row] = await query(`SELECT COALESCE(SUM(chips),0) AS s FROM user WHERE id IN (${placeholders})`, idsList);
  if (Number(row.s) === START * N) { conserved = true; break; }
}
const [finalRow] = await query(`SELECT COALESCE(SUM(chips),0) AS s FROM user WHERE id IN (${placeholders})`, idsList);

console.log("");
console.log(`[multiplay] RESULTS`);
console.log(`  distinct tables formed : ${tablesSeen.size}`);
console.log(`  hand results observed  : ${handResults}`);
console.log(`  socket errors (non-turn): ${errors}`);
console.log(`  wallet total after drain: ${Number(finalRow.s)} (expected ${START * N})`);
console.log(`  CHIP CONSERVATION      : ${conserved ? "OK ✅" : "MISMATCH ❌"}`);

// ---- cleanup ----
for (const u of users) { try { u.ws.close(); } catch {} }
await sleep(500);
// Remove throwaway users + any ephemeral tables they created (created_by
// is SET NULL after the user delete, so delete their tables first).
for (const tid of tablesSeen) {
  await execute("DELETE FROM poker_hand WHERE table_id = ?", [tid]).catch(() => {});
  await execute("DELETE FROM poker_table WHERE id = ?", [tid]).catch(() => {});
}
for (const u of users) await execute("DELETE FROM user WHERE id = ?", [u.id]).catch(() => {});
await closePool();
console.log(`[multiplay] done ${conserved && errors === 0 ? "— ALL GOOD" : ""}`);
process.exit(conserved ? 0 : 1);
