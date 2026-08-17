// Integration smoke test for the PlayOK-style hub (create / quick-play /
// presence / invite / close). Runs against the LOCAL dev DB only. Uses
// fake in-memory connections. Cleans up its throwaway users and exits.
//
//   node scripts/smoke-hub.js

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

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

const { execute, closePool } = await import("../src/lib/server/db.js");
const { hub } = await import("../src/lib/server/poker/hub.js");
const { C2S, S2C, encode } = await import("../src/lib/poker/protocol.js");

const uid = (n) => `smokehub-${n}-${randomBytes(4).toString("hex")}`;
async function mkUser(id, chips) {
  await execute(
    "INSERT INTO user (id, email, password_hash, display_name, is_admin, created_at, chips) VALUES (?,?,?,?,0,?,?)",
    [id, `${id}@ex.test`, "x", id, Date.now(), chips]
  );
}
function conn(id, name) {
  return { user: { id, email: `${id}@ex.test`, displayName: name, isAdmin: false }, watching: new Set(), frames: [],
    send(d) { this.frames.push(typeof d === "string" ? JSON.parse(d) : d); } };
}
const last = (c, t) => [...c.frames].reverse().find((f) => f.t === t);
const send = (c, t, extra = {}) => hub.handleMessage(c, encode(t, extra));

const A = uid("a"), B = uid("b"), C = uid("c"), D = uid("d"), P = uid("poor");
await mkUser(A, 10000); await mkUser(B, 10000); await mkUser(C, 10000);
await mkUser(D, 10000); await mkUser(P, 30);

const cleanupIds = [A, B, C, D, P];
try {
  const cA = conn(A, "Alice"), cB = conn(B, "Bob"), cC = conn(C, "Cara"), cD = conn(D, "Dan"), cP = conn(P, "Poor");
  for (const c of [cA, cB, cC, cD, cP]) { hub.addConnection(c); await send(c, C2S.LOBBY_SUB); }

  // 1) Create a table.
  await send(cA, C2S.TABLE_CREATE, { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 200 });
  const created = last(cA, S2C.TABLE_CREATED);
  assert.ok(created, "creator got table.created");
  const tid = created.tableId;
  const table = hub.tables.get(tid);
  assert.ok(table, "table is live in the hub");
  assert.ok(table.seatForUser(A), "creator is seated");
  const snapA = last(cA, S2C.LOBBY);
  assert.equal(snapA.tables.length, 1, "lobby shows the new table");
  assert.equal(snapA.tables[0].seated, 1, "table shows 1 seated");
  assert.ok(snapA.players.find((p) => p.id === A && p.location === tid), "Alice presence at the table");
  console.log("  [1] create OK");

  // 2) Insufficient chips -> refused, no table.
  await send(cP, C2S.TABLE_CREATE, { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 200 });
  assert.ok(last(cP, S2C.ERROR), "poor player refused");
  assert.equal(hub.tables.size, 1, "no extra table created");
  console.log("  [2] insufficient-chips refusal OK");

  // 3) Quick Play joins the existing 1-seat table (instant heads-up).
  await send(cB, C2S.QUICK_PLAY, {});
  const bCreated = last(cB, S2C.TABLE_CREATED);
  assert.equal(bCreated.tableId, tid, "quick play sent Bob to the open table");
  assert.ok(table.seatForUser(B), "Bob seated at the same table");
  assert.equal(table.seats.size, 2, "table now has 2 players");
  console.log("  [3] quick-play auto-seat OK");

  // 4) Lobby chat fan-out.
  cB.frames.length = 0;
  await send(cA, C2S.LOBBY_CHAT, { text: "hi all" });
  const chat = last(cB, S2C.LOBBY_CHAT);
  assert.ok(chat && chat.text === "hi all" && chat.from === "Alice", "lobby chat delivered");
  console.log("  [4] lobby chat OK");

  // 5) Invite Cara to Alice's table, Cara accepts -> seated.
  cC.frames.length = 0;
  await hub.invite(cA, C);
  const inv = last(cC, S2C.INVITE);
  assert.ok(inv && inv.tableId === tid, "Cara received the invite");
  await hub.respondInvite(cC, inv.inviteId, true);
  assert.ok(table.seatForUser(C), "Cara seated after accepting");
  console.log("  [5] invite + accept OK");

  // 6) Empty-table teardown: Dan creates a solo table, stands, leaves -> closed.
  await send(cD, C2S.TABLE_CREATE, { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 100 });
  const dTid = last(cD, S2C.TABLE_CREATED).tableId;
  assert.ok(hub.tables.get(dTid), "Dan's table live");
  await send(cD, C2S.TABLE_STAND, { tableId: dTid });   // frees the only seat (no hand, solo)
  await send(cD, C2S.TABLE_LEAVE, { tableId: dTid });    // last watcher leaves -> close
  assert.ok(!hub.tables.get(dTid), "empty table torn down");
  console.log("  [6] empty-table teardown OK");

  console.log("[smoke-hub] ALL OK");
} finally {
  // Stop any pending table timers so the process can exit, then clean up.
  for (const t of hub.tables.values()) { t.clearActionTimer?.(); t.clearStartTimer?.(); }
  for (const id of cleanupIds) await execute("DELETE FROM user WHERE id = ?", [id]).catch(() => {});
  await execute("DELETE FROM poker_table WHERE created_by IS NULL AND 1=0").catch(() => {});
  await closePool();
  process.exit(0);
}
