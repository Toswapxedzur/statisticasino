// Time bank: when a PRESENT player's action clock runs out, they get ONE
// extension paid from their per-seat time bank before the table auto-acts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LiveTable, ACTION_TIMEOUT_MS, TIME_BANK_INIT_MS, TIME_BANK_PER_HAND_MS, TIME_BANK_EXTEND_MS
} from "./table.js";

function makeClock() {
  let t = 0;
  const timers = new Map();
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const i = ++id; timers.set(i, { fn, ms }); return i; },
    clearTimer: (i) => timers.delete(i),
    pendingMs: () => [...timers.values()].map((x) => x.ms),
    async fireMs(ms) {
      const e = [...timers.entries()].find(([, x]) => x.ms === ms);
      if (!e) throw new Error(`no timer for ${ms}; have ${[...timers.values()].map((x) => x.ms)}`);
      timers.delete(e[0]); t += ms; await e[1].fn();
    }
  };
}

function makeWallet() {
  const bal = new Map([["u0", 10000], ["u1", 10000]]);
  const escrow = new Map();
  return {
    async buyIn(uid, amt, tid, seat) { bal.set(uid, bal.get(uid) - amt); escrow.set(`${tid}:${seat}`, { userId: uid, stack: amt }); return bal.get(uid); },
    async cashOut(tid, seat, expect) { const r = escrow.get(`${tid}:${seat}`); if (!r) return { balance: bal.get(expect) ?? 0, refunded: 0 }; bal.set(r.userId, (bal.get(r.userId) ?? 0) + r.stack); escrow.delete(`${tid}:${seat}`); return { balance: bal.get(r.userId), refunded: r.stack }; },
    async syncStacks() {},
    async rebuy(uid, amt, tid, seat) { bal.set(uid, bal.get(uid) - amt); const r = escrow.get(`${tid}:${seat}`); r.stack += amt; return { balance: bal.get(uid), stack: r.stack }; }
  };
}

const makeStore = () => { let n = 0; return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } }; };
const makeConn = (id) => ({ user: { id, displayName: id }, watching: new Set(), send() {} });
const CONFIG = { id: "tb", name: "TB", variant: "holdem", max_seats: 6, small_blind: 1, big_blind: 2, min_buyin: 40, max_buyin: 200 };

test("a present player who stalls gets one time-bank extension, then auto-acts", async () => {
  const clock = makeClock();
  const table = new LiveTable(CONFIG, null, {
    wallet: makeWallet(), store: makeStore(),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, rng: () => 0.5, autoStart: false
  });
  const c0 = makeConn("u0"); const c1 = makeConn("u1");
  table.addWatcher(c0); table.addWatcher(c1);
  await table.sit(c0, 0, 100);
  await table.sit(c1, 1, 100);
  await table.beginHand();

  const actor = table.seats.get(table.hand.toActSeat);
  // Topped up at beginHand: INIT + one PER_HAND increment.
  assert.equal(actor.timeBankMs, TIME_BANK_INIT_MS + TIME_BANK_PER_HAND_MS, "bank topped up for the hand");
  assert.ok(clock.pendingMs().includes(ACTION_TIMEOUT_MS), "normal action clock armed");
  const actingSeat = table.hand.toActSeat;

  // Clock runs out: instead of auto-acting, the bank buys an extension.
  await clock.fireMs(ACTION_TIMEOUT_MS);
  assert.equal(table.hand.toActSeat, actingSeat, "still the same player's turn (extended, not auto-acted)");
  assert.equal(actor.timeBankMs, TIME_BANK_INIT_MS + TIME_BANK_PER_HAND_MS - TIME_BANK_EXTEND_MS, "extension drew from the bank");
  assert.ok(clock.pendingMs().includes(TIME_BANK_EXTEND_MS), "extension timer armed");

  // Extension also elapses → now the table auto-acts and the turn moves on.
  await clock.fireMs(TIME_BANK_EXTEND_MS);
  assert.ok(table.hand === null || table.hand.toActSeat !== actingSeat, "auto-acted after the bank ran out");
});
