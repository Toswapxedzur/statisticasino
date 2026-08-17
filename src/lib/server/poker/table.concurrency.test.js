// Concurrency tests for LiveTable's op-lock. These exercise the exact
// races the adversarial review flagged (chip-minting via re-entrancy),
// which the sequential sims can't reach because they await every op.
// The gateway dispatches WS frames WITHOUT awaiting, so two frames can
// arrive while one op is parked on a wallet/DB await — we reproduce that
// by firing ops without awaiting the first, then draining.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveTable } from "./table.js";

function makeWallet(init) {
  const bal = new Map(Object.entries(init));
  const escrow = new Map(); // `${tableId}:${seatNo}` -> { userId, stack }
  let credits = 0;
  let debits = 0;
  return {
    balances: bal,
    escrow,
    creditCount: () => credits,
    debitCount: () => debits,
    async debit(uid, amt) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt); debits++; return b - amt;
    },
    async credit(uid, amt) {
      const b = bal.get(uid) ?? 0; bal.set(uid, b + amt); credits++; return b + amt;
    },
    // Bank layer — escrow-aware, mirrors bank.js (escrow-authoritative cash-out).
    async buyIn(uid, amt, tableId, seatNo) {
      const b = await this.debit(uid, amt);
      escrow.set(`${tableId}:${seatNo}`, { userId: uid, stack: amt });
      return b;
    },
    async rebuy(uid, amt, tableId, seatNo) {
      const b = await this.debit(uid, amt);
      const r = escrow.get(`${tableId}:${seatNo}`);
      if (!r || r.userId !== uid) { const e = new Error("escrow missing"); e.code = "ESCROW_MISSING"; throw e; }
      r.stack += amt;
      return { balance: b, stack: r.stack };
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const key = `${tableId}:${seatNo}`;
      const r = escrow.get(key);
      if (!r) return { balance: expectUserId ? (bal.get(expectUserId) ?? 0) : 0, refunded: 0 };
      const balance = r.stack > 0 ? await this.credit(r.userId, r.stack) : (bal.get(r.userId) ?? 0);
      escrow.delete(key);
      return { balance, refunded: r.stack };
    },
    async syncStacks(tableId, seats) {
      for (const s of seats) { const r = escrow.get(`${tableId}:${s.seatNo}`); if (r && r.userId === s.userId) r.stack = s.stack; }
    },
    total() { let s = 0; for (const v of bal.values()) s += v; return s; }
  };
}

function makeStore(nextHandNo) {
  return {
    persisted: [],
    nextHandNo: nextHandNo || (async () => 1),
    async persistHand(h) { this.persisted.push(h); return "h"; }
  };
}

function makeConn(id) {
  return { user: { id, displayName: id }, watching: new Set(), frames: [],
    send(d) { this.frames.push(typeof d === "string" ? JSON.parse(d) : d); } };
}

const CFG = { id: "c", name: "C", max_seats: 6, small_blind: 5, big_blind: 10, min_buyin: 40, max_buyin: 400 };
const NOOP_DEPS = { now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: () => 0.5, autoStart: false };

function seatStackTotal(table) {
  let s = 0; for (const x of table.seats.values()) s += x.stack; return s;
}

test("concurrent double-stand credits the wallet exactly once (no chip minting)", async () => {
  const wallet = makeWallet({ u0: 1000, u1: 1000 });
  const INITIAL = wallet.total();
  const table = new LiveTable(CFG, null, { wallet, store: makeStore(), ...NOOP_DEPS });
  const c0 = makeConn("u0");
  table.addWatcher(c0);
  await table.sit(c0, 0, 200);
  assert.equal(table.seats.size, 1);

  // Two stand frames back-to-back, WITHOUT awaiting the first.
  const p1 = table.stand(c0);
  const p2 = table.stand(c0);
  await Promise.all([p1, p2]);

  assert.equal(table.seats.size, 0, "seat removed");
  assert.equal(wallet.creditCount(), 1, "wallet credited exactly once");
  assert.equal(wallet.balances.get("u0"), 1000, "balance restored, not doubled");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

test("concurrent double-sit yields one seat and one debit", async () => {
  const wallet = makeWallet({ u0: 1000 });
  const table = new LiveTable(CFG, null, { wallet, store: makeStore(), ...NOOP_DEPS });
  const c0 = makeConn("u0");
  table.addWatcher(c0);

  const p1 = table.sit(c0, 0, 200);
  const p2 = table.sit(c0, 1, 200); // same user, different seat, same tick
  await Promise.all([p1, p2]);

  assert.equal(table.seats.size, 1, "user occupies exactly one seat");
  assert.equal(wallet.debitCount(), 1, "charged exactly one buy-in");
  assert.equal(wallet.balances.get("u0"), 800, "debited once");
});

test("a stand arriving during beginHand's DB await is serialized, not misclassified", async () => {
  // A nextHandNo we hold open to force the beginHand await window.
  let release;
  const gate = new Promise((r) => { release = r; });
  const store = makeStore(async () => { await gate; return 1; });
  const wallet = makeWallet({ u0: 1000, u1: 1000 });
  const INITIAL = wallet.total();
  const table = new LiveTable(CFG, null, { wallet, store, ...NOOP_DEPS });
  const c0 = makeConn("u0");
  const c1 = makeConn("u1");
  table.addWatcher(c0);
  table.addWatcher(c1);
  await table.sit(c0, 0, 200);
  await table.sit(c1, 1, 200);

  // Start a hand through the op-lock, exactly as the production start timer
  // does. It parks on `await gate` inside beginHand.
  const beginP = table._run(() => table.beginHand());
  // A stand for c0 lands during that window. Pre-fix it would take the
  // "not in hand" branch and refund c0's FULL pre-hand stack while their
  // blind is already in the pot. With the op-lock it must queue behind
  // beginHand and see c0 correctly dealt-in.
  const standP = table.stand(c0);

  release();
  await beginP;
  await standP;

  // c0 was dealt in (heads-up button/SB), so stand only flagged them to
  // leave; no refund yet, chips still conserved.
  assert.ok(table.seats.get(0), "c0 still seated (leave deferred to hand end)");
  assert.equal(table.seats.get(0).wantsToLeave, true, "flagged to leave, not cashed out mid-hand");
  assert.equal(wallet.creditCount(), 0, "no premature cash-out");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved mid-hand");

  // Drive the hand to completion: c0 (to act first heads-up) folds.
  assert.equal(table.hand.toActSeat, 0, "button/SB acts first preflop heads-up");
  await table.act(c0, { type: "fold" });

  assert.equal(table.hand, null, "hand completed");
  assert.equal(wallet.creditCount(), 1, "c0 cashed out exactly once at hand end");
  assert.ok(!table.seats.get(0), "c0's seat freed after leaving");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved after settle");
});
