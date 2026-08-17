// Dev-only headless bot player. Connects to the running dev server over
// WebSocket as a throwaway account, sits at a table, and auto-plays
// (calling station) so a human in the browser can play a real hand.
//
// Usage: node scripts/poker-bot.js <tableId> [seat] [buyin] [name]
// LOCAL DEV ONLY (creates a user + session in whatever .env points at).

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

let tableId = process.argv[2];
const seat = process.argv[3] != null ? Number(process.argv[3]) : 0;
const buyin = process.argv[4] != null ? Number(process.argv[4]) : 200;
const name = process.argv[5] || "Botford";
// Pass "quickplay" as the table id to exercise the auto-seat matcher.
const quick = tableId === "quickplay";
if (!tableId) { console.error("usage: node scripts/poker-bot.js <tableId|quickplay> [seat] [buyin] [name]"); process.exit(1); }

const auth = await import("../src/lib/server/auth.js");
const wallet = await import("../src/lib/server/wallet.js");
const { closePool } = await import("../src/lib/server/db.js");
const { C2S, S2C, encode, decode } = await import("../src/lib/poker/protocol.js");

// Create (or reuse) a throwaway bot account + session.
const email = `bot-${name.toLowerCase()}@example.test`;
let user = await auth.findUserByEmail(email);
if (!user) user = await auth.createUser(email, randomBytes(8).toString("hex"), name);
await wallet.ensureStartingGrant(user.id);
const { token } = await auth.createSession(user.id);
console.log(`[bot ${name}] user=${user.id} seat=${seat} buyin=${buyin}`);

const ws = new WebSocket("ws://localhost:5273/ws", {
  headers: { Cookie: `casino_session=${token}` }
});

ws.on("open", () => {
  ws.send(encode(C2S.HELLO));
  if (quick) {
    // Auto-seat via the matcher; we learn our tableId from table.created.
    ws.send(encode(C2S.QUICK_PLAY, { buyin }));
  } else {
    ws.send(encode(C2S.TABLE_JOIN, { tableId }));
    setTimeout(() => ws.send(encode(C2S.TABLE_SIT, { tableId, seat, buyin })), 300);
  }
});

ws.on("message", (data) => {
  const msg = decode(data.toString("utf8"));
  if (!msg) return;
  if (msg.t === S2C.ERROR) console.log(`[bot ${name}] ERROR: ${msg.msg}`);
  if (msg.t === S2C.TABLE_CREATED) {
    tableId = msg.tableId;
    console.log(`[bot ${name}] seated at table ${tableId}`);
    ws.send(encode(C2S.TABLE_JOIN, { tableId })); // subscribe for state + turns
  }
  if (msg.t === S2C.TABLE_TURN) {
    // Calling-station: check if free, else call, else fold. Small delay so
    // the human can watch.
    const acts = msg.actions || [];
    let choice = acts.find((a) => a.type === "check")
      || acts.find((a) => a.type === "call")
      || { type: "fold" };
    setTimeout(() => ws.send(encode(C2S.TABLE_ACTION, { tableId, action: { type: choice.type } })), 900);
    console.log(`[bot ${name}] turn -> ${choice.type}${choice.amount ? " " + choice.amount : ""}`);
  }
  if (msg.t === S2C.TABLE_STATE && msg.table?.result) {
    const r = msg.table.result;
    console.log(`[bot ${name}] hand result: ${r.type} winners=${JSON.stringify(r.winners)}`);
  }
});

ws.on("close", async () => { await closePool().catch(() => {}); process.exit(0); });
ws.on("error", (e) => console.error(`[bot ${name}] ws error`, e.message));

// Safety: auto-exit after 3 minutes.
setTimeout(() => { try { ws.close(); } catch {} }, 180000).unref?.();
