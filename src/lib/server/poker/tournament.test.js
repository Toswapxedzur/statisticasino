// Sit-N-Go tournament: blind schedule + prize split (pure), registration money
// flow, and a full run driven through onHandEnd — asserting the prize pool is
// conserved (entries in = payouts out) and goes to the humans by finish.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Tournament, levelForHands, prizeSplit, BLIND_LEVELS } from "./tournament.js";
import { LiveTable } from "./table.js";
import { legalActions } from "./engine/index.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- wallet mock ({ debit, credit }) over an in-memory balance map ----
function makeWallet(init) {
  const bal = new Map(Object.entries(init));
  return {
    bal,
    async debit(uid, amt) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt); return b - amt;
    },
    async credit(uid, amt) { bal.set(uid, (bal.get(uid) ?? 0) + amt); return bal.get(uid); },
    total() { let s = 0; for (const v of bal.values()) s += v; return s; }
  };
}

// A light fake table with just the surface the Tournament touches.
function makeTable() {
  const seats = new Map();
  let hands = 0;
  return {
    config: { smallBlind: 0, bigBlind: 0 },
    seats,
    tournament: null,
    handsBegun: () => hands,
    addWatcher() {},
    async sit(conn, seat, stack) { seats.set(seat, { seat, userId: conn.user.id, name: conn.user.displayName, stack }); },
    async beginHand() { hands += 1; },
    clearActionTimer() {}
  };
}
const conn = (id) => ({ user: { id, displayName: id }, watching: new Set(), send() {} });

test("levelForHands escalates every N hands and clamps to the schedule", () => {
  assert.equal(levelForHands(0), 0);
  assert.equal(levelForHands(7), 0);
  assert.equal(levelForHands(8), 1);
  assert.equal(levelForHands(16), 2);
  assert.equal(levelForHands(9999), BLIND_LEVELS.length - 1);
});

test("prizeSplit always sums to the pool", () => {
  assert.deepEqual(prizeSplit(300, 3, "winner"), [300]);
  assert.deepEqual(prizeSplit(0, 3), []);
  const top3 = prizeSplit(301, 5, "top3");
  assert.equal(top3.reduce((a, b) => a + b, 0), 301, "top3 sums exactly to the (odd) pool");
  assert.equal(top3.length, 3);
});

test("registration debits the entry into the pool; unregister refunds it", async () => {
  const wallet = makeWallet({ a: 1000, b: 1000, c: 50 });
  const t = new Tournament({ id: "t1", name: "SNG", entry: 100, maxSeats: 6, table: makeTable(), wallet });
  assert.deepEqual(await t.register(conn("a")), { ok: true });
  assert.equal(wallet.bal.get("a"), 900);
  assert.equal(t.prizePool, 100);
  assert.deepEqual(await t.register(conn("a")), { error: "You're already registered." });
  assert.equal((await t.register(conn("c"))).error, "Not enough chips for the entry.");
  await t.unregister("a");
  assert.equal(wallet.bal.get("a"), 1000, "entry refunded");
  assert.equal(t.prizePool, 0);
});

test("a full run: pool is conserved and paid to the last human standing; bot excluded", async () => {
  const wallet = makeWallet({ a: 1000, b: 1000, c: 1000, bot1: 0 });
  const total0 = wallet.total();
  const table = makeTable();
  const t = new Tournament({ id: "t2", name: "SNG", entry: 100, startingStack: 300, maxSeats: 4, table, wallet });
  for (const u of ["a", "b", "c"]) assert.deepEqual(await t.register(conn(u)), { ok: true });
  assert.equal(t.prizePool, 300);

  await t.start({ bots: [conn("bot1")] }); // 3 humans + 1 bot, 300 T-chips each
  assert.equal(t.status, "running");
  assert.equal(table.seats.size, 4);
  const tchips = () => [...table.seats.values()].reduce((s, p) => s + p.stack, 0);
  assert.equal(tchips(), 1200, "1200 T-chips in play");

  // Simulate hands: move all of one player's chips to another (a bust), then end
  // the hand. T-chip total stays 1200 throughout.
  const bust = (loser, winner) => {
    const l = [...table.seats.values()].find((s) => s.userId === loser);
    const w = [...table.seats.values()].find((s) => s.userId === winner);
    w.stack += l.stack; l.stack = 0;
  };
  bust("bot1", "a"); await t.onHandEnd(table); assert.equal(tchips(), 1200);   // bot out 4th
  bust("c", "b");    await t.onHandEnd(table); assert.equal(tchips(), 1200);   // c out 3rd
  bust("b", "a");    await t.onHandEnd(table); // b out 2nd → a wins

  assert.equal(t.status, "complete");
  assert.equal(wallet.total(), total0, "chips conserved end-to-end (entries in = payouts out)");
  assert.equal(wallet.bal.get("a"), 900 + 300, "winner got the whole 300 pool back on top of their post-entry balance");
  assert.equal(t.places.get("a"), 1);
  assert.equal(t.places.get("b"), 2);
  assert.equal(t.places.get("c"), 3);
  assert.equal(t.places.get("bot1"), 4);
  assert.equal(wallet.bal.get("bot1"), 0, "bot never cashed");
});

test("integration: a real tournament-mode table plays to completion, T-chips + pool conserved", async () => {
  const wallet = makeWallet({ a: 1000, b: 1000, c: 1000 });
  const total0 = wallet.total();
  // Real LiveTable in tournament mode. Escrow is gated off, so the wallet/store
  // deps are stubs; autoStart off so we drive hands manually (no clock needed).
  const table = new LiveTable(
    { id: "tny-int", name: "SNG", variant: "holdem", max_seats: 6, small_blind: 0, big_blind: 0, min_buyin: 1, max_buyin: 100000, tournament: true },
    null,
    { wallet: {}, store: { async nextHandNo() { return 1; }, async persistHand() { return "h"; } },
      now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(9), autoStart: false }
  );
  const t = new Tournament({ id: "tny-int", name: "SNG", variant: "holdem", entry: 100, startingStack: 300, maxSeats: 6, table, wallet });

  const conns = {};
  for (const u of ["a", "b", "c"]) { conns[u] = conn(u); assert.deepEqual(await t.register(conns[u]), { ok: true }); }
  assert.equal(t.prizePool, 300);
  await t.start({ bots: [] });
  const tchips = () => [...table.seats.values()].reduce((s, p) => s + p.stack, 0);
  assert.equal(tchips(), 900, "3 x 300 T-chips");

  // Drive hands: everyone shoves each hand → fast busts. onHandEnd (inside
  // finishHand) escalates blinds + eliminates + ends; we begin the next hand.
  let guard = 0;
  while (t.status === "running") {
    assert.ok(guard++ < 200, "tournament terminates");
    let inner = 0;
    while (table.hand && table.hand.toActSeat != null) {
      assert.ok(inner++ < 400, "hand terminates");
      const menu = legalActions(table.hand);
      const seat = menu.toActSeat;
      const uid = table.seats.get(seat)?.userId;
      const c = conns[uid];
      const a = menu.actions.find((x) => x.type === "allin") || menu.actions.find((x) => x.type === "call") || menu.actions.find((x) => x.type === "check") || menu.actions.find((x) => x.type === "fold");
      await table.act(c, { type: a.type, amount: a.amount });
    }
    // Between hands: while the event runs and T-chips are conserved, deal the next.
    if (t.status === "running") {
      assert.equal(tchips(), 900, "T-chips conserved between hands");
      if (table.seats.size >= 2) await table.beginHand(); else break;
    }
  }

  assert.equal(t.status, "complete");
  assert.equal(wallet.total(), total0, "wallet conserved end-to-end (entries in = payout out)");
  const winner = [...t.places.entries()].find(([, place]) => place === 1)?.[0];
  assert.ok(["a", "b", "c"].includes(winner), "a human won");
  assert.equal(wallet.bal.get(winner), 900 + 300, "winner got the 300 pool");
  assert.equal(t.places.size, 3, "all three placed");
});

test("aborting an in-flight tournament refunds every entry, conserved + idempotent", async () => {
  const wallet = makeWallet({ a: 1000, b: 1000 });
  const total0 = wallet.total();
  const t = new Tournament({ id: "t4", name: "SNG", entry: 100, maxSeats: 6, table: makeTable(), wallet });
  await t.register(conn("a")); await t.register(conn("b"));
  assert.equal(t.prizePool, 200);
  await t.abortRefund();
  assert.equal(t.status, "complete");
  assert.equal(wallet.bal.get("a"), 1000);
  assert.equal(wallet.bal.get("b"), 1000);
  assert.equal(wallet.total(), total0, "refund conserves chips");
  await t.abortRefund(); // idempotent — no double refund
  assert.equal(wallet.total(), total0);
});

test("blinds escalate as hands accumulate", async () => {
  const table = makeTable();
  const t = new Tournament({ id: "t3", name: "SNG", entry: 0, startingStack: 500, maxSeats: 4, table, wallet: makeWallet({}), handsPerLevel: 2 });
  await t.register(conn("a")); await t.register(conn("b")); await t.register(conn("c"));
  await t.start();
  assert.deepEqual([table.config.smallBlind, table.config.bigBlind], [BLIND_LEVELS[0].sb, BLIND_LEVELS[0].bb]);
  await t.onHandEnd(table); await t.onHandEnd(table); // 2 hands → level 1
  assert.deepEqual([table.config.smallBlind, table.config.bigBlind], [BLIND_LEVELS[1].sb, BLIND_LEVELS[1].bb]);
});
