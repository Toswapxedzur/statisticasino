// Vacate / teardown tests for LiveTable.
//
// Covers the disconnected-seat leak: a seated player who loses their socket
// must not keep an ephemeral table alive forever. After a grace window the
// seat is auto-stood (stack returned to the wallet) and, once the table is
// empty, the hub reclaims it. A reconnect inside the window cancels the
// pending auto-stand. Everything time/DB is injected so the whole thing is
// deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveTable, SEAT_VACATE_GRACE_MS, DISCONNECT_GRACE_MS } from "./table.js";

// ------------------------------------------------------- fakes

function makeWallet(initial) {
  const balances = new Map(Object.entries(initial));
  const escrow = new Map(); // `${tableId}:${seatNo}` -> { userId, stack }
  const api = {
    balances,
    escrow,
    failCredit: false, // flip on to simulate a transient wallet outage
    async debit(userId, amount) {
      const bal = balances.get(userId) ?? 0;
      if (bal - amount < 0) {
        const e = new Error("insufficient chips");
        e.code = "INSUFFICIENT_CHIPS";
        throw e;
      }
      const next = bal - amount;
      balances.set(userId, next);
      return next;
    },
    async credit(userId, amount) {
      if (api.failCredit) throw new Error("wallet unavailable");
      const next = (balances.get(userId) ?? 0) + amount;
      balances.set(userId, next);
      return next;
    },
    // Bank layer — escrow-aware, mirrors bank.js. cashOut credits BEFORE
    // deleting escrow so a failCredit throw leaves the row intact (emulating tx
    // rollback), which is exactly what the transient-failure retry test needs.
    async buyIn(userId, amount, tableId, seatNo) {
      const bal = await this.debit(userId, amount);
      escrow.set(`${tableId}:${seatNo}`, { userId, stack: amount });
      return bal;
    },
    async rebuy(userId, amount, tableId, seatNo) {
      const bal = await this.debit(userId, amount);
      const r = escrow.get(`${tableId}:${seatNo}`);
      if (!r || r.userId !== userId) { const e = new Error("escrow missing"); e.code = "ESCROW_MISSING"; throw e; }
      r.stack += amount;
      return bal;
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const key = `${tableId}:${seatNo}`;
      const r = escrow.get(key);
      if (!r) return { balance: expectUserId ? (balances.get(expectUserId) ?? 0) : 0, refunded: 0 };
      if (expectUserId && r.userId !== expectUserId) { const e = new Error("owner mismatch"); e.code = "ESCROW_OWNER_MISMATCH"; throw e; }
      const balance = r.stack > 0 ? await this.credit(r.userId, r.stack) : (balances.get(r.userId) ?? 0);
      escrow.delete(key); // only after a successful credit
      return { balance, refunded: r.stack };
    },
    async syncStacks(tableId, seats) {
      for (const s of seats) { const r = escrow.get(`${tableId}:${s.seatNo}`); if (r && r.userId === s.userId) r.stack = s.stack; }
    },
    total() {
      let sum = 0;
      for (const v of balances.values()) sum += v;
      return sum;
    }
  };
  return api;
}

function makeStore() {
  let n = 0;
  return {
    async nextHandNo() {
      return ++n;
    },
    async persistHand() {
      return "hand";
    }
  };
}

// Manual clock. Unlike the sim/adversarial clocks this one may hold more than
// one pending timer at once (e.g. an action clock alongside a vacate clock),
// so it fires by matching the requested delay.
function makeClock() {
  let seq = 0;
  let t = 1000;
  const timers = new Map();
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, ms, id });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    pendingCount: () => timers.size,
    pendingMs: () => [...timers.values()].map((x) => x.ms),
    async fireMs(ms) {
      const entry = [...timers.values()].find((x) => x.ms === ms);
      assert.ok(entry, `expected a pending timer with ms=${ms}`);
      timers.delete(entry.id);
      await entry.fn();
      return true;
    }
  };
}

function makeConn(id, displayName) {
  const frames = [];
  return {
    user: { id, displayName },
    watching: new Set(),
    frames,
    send(data) {
      frames.push(typeof data === "string" ? JSON.parse(data) : data);
    }
  };
}

// Minimal hub mirroring PokerHub.maybeCloseTable's teardown rule, so we can
// assert an emptied ephemeral table is actually reclaimed.
function makeHub() {
  const tables = new Map();
  const events = { changed: 0, closed: [] };
  const reclaim = (table) => { tables.delete(table.id); events.closed.push(table.id); };
  const hub = {
    tables,
    onTableChanged() {
      events.changed += 1;
    },
    // Mirror the real hub: out-of-op callers serialize the empty-check behind
    // the op-lock via tryClose; in-op callers use the synchronous variant.
    async maybeCloseTable(table) {
      if (!table || table._spawning) return;
      const closed = await table.tryClose?.();
      if (closed) reclaim(table);
    },
    async reclaimIfEmptyLocked(table) {
      if (!table || table._spawning) return;
      if (table.markClosedIfEmpty?.()) reclaim(table);
    }
  };
  return { hub, tables, events };
}

const CONFIG = {
  id: "t-vac",
  name: "Vacate Table",
  variant: "holdem",
  max_seats: 6,
  small_blind: 1,
  big_blind: 2,
  min_buyin: 40,
  max_buyin: 200
};

function makeTable(clock, wallet, store, hub) {
  const table = new LiveTable(CONFIG, hub, {
    wallet,
    store,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    rng: () => 0.5,
    autoStart: false
  });
  return table;
}

function seatStackTotal(table) {
  let sum = 0;
  for (const s of table.seats.values()) sum += s.stack;
  return sum;
}

// --------------------------------------------------------------- test 1

test("lone disconnected player is auto-vacated and the empty table is reclaimed", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000 });
  const store = makeStore();
  const { hub, tables, events } = makeHub();
  const INITIAL = wallet.total();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const conn = makeConn("u0", "Solo");
  table.addWatcher(conn);
  await table.sit(conn, 0, 100);
  assert.equal(table.seats.size, 1, "seated");
  assert.equal(wallet.balances.get("u0"), 9_900, "buy-in debited");

  // Disconnect exactly as the hub does: detach the watcher, then notify.
  table.removeWatcher(conn);
  table.onConnectionGone(conn);

  // No hand ever ran → the seat is idle+gone → a single vacate timer is armed.
  assert.deepEqual(clock.pendingMs(), [SEAT_VACATE_GRACE_MS], "vacate timer armed");
  assert.equal(table.seats.size, 1, "still seated during the grace window");

  await clock.fireMs(SEAT_VACATE_GRACE_MS);

  assert.equal(table.seats.size, 0, "seat auto-vacated");
  assert.equal(wallet.balances.get("u0"), INITIAL, "stack returned to wallet");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
  assert.ok(!tables.has(table.id), "empty ephemeral table reclaimed by the hub");
  assert.deepEqual(events.closed, [table.id], "hub.maybeCloseTable closed it");
});

// --------------------------------------------------------------- test 2

test("reconnect inside the grace window cancels the auto-vacate", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000 });
  const store = makeStore();
  const { hub, tables } = makeHub();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const conn = makeConn("u0", "Solo");
  table.addWatcher(conn);
  await table.sit(conn, 0, 100);

  table.removeWatcher(conn);
  table.onConnectionGone(conn);
  assert.equal(clock.pendingCount(), 1, "vacate timer armed on disconnect");

  // A fresh socket for the same user reconnects.
  const conn2 = makeConn("u0", "Solo");
  table.addWatcher(conn2);
  assert.equal(clock.pendingCount(), 0, "reconnect cancelled the pending auto-stand");
  assert.equal(table.seats.size, 1, "seat retained");
  assert.equal(table.isConnected(table.seats.get(0)), true, "shows connected again");
});

// --------------------------------------------------------------- test 3

test("a player who disconnects mid-hand is vacated after the hand settles", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000, u1: 10_000 });
  const store = makeStore();
  const { hub, tables } = makeHub();
  const INITIAL = wallet.total();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const c0 = makeConn("u0", "P0");
  const c1 = makeConn("u1", "P1");
  table.addWatcher(c0);
  table.addWatcher(c1);
  await table.sit(c0, 0, 100);
  await table.sit(c1, 1, 100);

  await table.beginHand();
  assert.ok(table.hand, "a hand is running");
  assert.equal(table.hand.toActSeat, 0, "seat0 (button/SB heads-up) acts first");

  // seat1 (NOT the actor) drops mid-hand: still dealt in, so no vacate yet.
  table.removeWatcher(c1);
  table.onConnectionGone(c1);
  assert.ok(table.seats.get(1).inHand, "seat1 still in the hand");
  assert.ok(!clock.pendingMs().includes(SEAT_VACATE_GRACE_MS), "no vacate timer during the hand");

  // seat0 folds → hand ends uncontested; finishHand arms the vacate for the
  // still-disconnected seat1.
  await table.act(c0, { type: "fold" });
  assert.equal(table.hand, null, "hand complete");
  assert.ok(clock.pendingMs().includes(SEAT_VACATE_GRACE_MS), "vacate armed at hand end");

  await clock.fireMs(SEAT_VACATE_GRACE_MS);

  assert.ok(!table.seats.get(1), "disconnected seat1 vacated");
  assert.ok(table.seats.get(0), "connected seat0 stays");
  assert.equal(table.isConnected(table.seats.get(0)), true, "seat0 still connected");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
  assert.ok(tables.has(table.id), "table stays alive while a player remains");
});

// --------------------------------------------------------------- test 4

test("all players Stand mid-hand then leave -> finishHand reclaims the empty table", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000, u1: 10_000 });
  const store = makeStore();
  const { hub, tables, events } = makeHub();
  const INITIAL = wallet.total();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const c0 = makeConn("u0", "P0");
  const c1 = makeConn("u1", "P1");
  table.addWatcher(c0);
  table.addWatcher(c1);
  await table.sit(c0, 0, 100);
  await table.sit(c1, 1, 100);
  await table.beginHand();
  assert.ok(table.hand, "a hand is running");

  // Both request to leave mid-hand (deferred cash-out), then both disconnect.
  await table.stand(c0);
  await table.stand(c1);
  assert.ok(
    table.seats.get(0).wantsToLeave && table.seats.get(1).wantsToLeave,
    "both flagged to leave at hand end"
  );
  table.removeWatcher(c0);
  table.onConnectionGone(c0);
  table.removeWatcher(c1);
  table.onConnectionGone(c1);

  // The disconnected actor auto-acts on the shortened grace clock, completing
  // the hand; finishHand cashes both out and reclaims the now-empty table.
  await clock.fireMs(DISCONNECT_GRACE_MS);

  assert.equal(table.hand, null, "hand complete");
  assert.equal(table.seats.size, 0, "both seats cashed out");
  assert.ok(!tables.has(table.id), "empty table reclaimed at hand end");
  assert.deepEqual(events.closed, [table.id], "hub closed it exactly once");
  assert.equal(wallet.total(), INITIAL, "all chips back in wallets");
});

// --------------------------------------------------------------- test 5

test("a transient cash-out failure re-arms the auto-vacate instead of stranding the table", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000 });
  const store = makeStore();
  const { hub, tables } = makeHub();
  const INITIAL = wallet.total();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const conn = makeConn("u0", "Solo");
  table.addWatcher(conn);
  await table.sit(conn, 0, 100);

  table.removeWatcher(conn);
  table.onConnectionGone(conn);
  assert.deepEqual(clock.pendingMs(), [SEAT_VACATE_GRACE_MS], "vacate armed");

  // Wallet is down when the first vacate fires: the seat must survive, and a
  // fresh vacate timer must be armed for the retry.
  wallet.failCredit = true;
  await clock.fireMs(SEAT_VACATE_GRACE_MS);
  assert.equal(table.seats.size, 1, "seat retained after failed cash-out");
  assert.equal(wallet.balances.get("u0"), 9_900, "no chips created on failure");
  assert.deepEqual(clock.pendingMs(), [SEAT_VACATE_GRACE_MS], "vacate re-armed for retry");
  assert.ok(tables.has(table.id), "table not reclaimed while the seat remains");

  // Wallet recovers; the retry completes the vacate and reclaims the table.
  wallet.failCredit = false;
  await clock.fireMs(SEAT_VACATE_GRACE_MS);
  assert.equal(table.seats.size, 0, "seat vacated on retry");
  assert.equal(wallet.total(), INITIAL, "chips conserved");
  assert.ok(!tables.has(table.id), "empty table reclaimed after retry");
});

// --------------------------------------------------------------- test 6

test("cashOutAll drains every seat back to its wallet (graceful shutdown)", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 10_000, u1: 10_000 });
  const store = makeStore();
  const { hub, tables } = makeHub();
  const INITIAL = wallet.total();

  const table = makeTable(clock, wallet, store, hub);
  tables.set(table.id, table);

  const c0 = makeConn("u0", "P0");
  const c1 = makeConn("u1", "P1");
  table.addWatcher(c0);
  table.addWatcher(c1);
  await table.sit(c0, 0, 120);
  await table.sit(c1, 1, 80);
  await table.beginHand();
  assert.ok(table.hand, "drain happens with a hand in flight");

  await table.cashOutAll();

  assert.equal(table.seats.size, 0, "all seats drained");
  assert.equal(table.hand, null, "hand abandoned");
  assert.equal(wallet.balances.get("u0"), INITIAL / 2, "u0 fully refunded");
  assert.equal(wallet.balances.get("u1"), INITIAL / 2, "u1 fully refunded");
  assert.equal(wallet.total(), INITIAL, "chips conserved across the drain");
});
