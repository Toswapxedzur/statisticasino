// Integration test: BotConns seated at a REAL LiveTable, playing full hands
// through the same sit()/act()/finishHand() paths a human uses. Proves the bot
// wiring is correct end-to-end: every action the bot submits is legal, hands
// run to completion, chips are conserved to the chip, and the bots actually
// play poker (reach flops and showdowns) rather than folding everything.
//
// The table's timers are stubbed and hands are driven manually (autoStart:false)
// like the other table tests; the bot's "think" scheduler is injected to push
// each pending decision onto a queue the test pumps deterministically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveTable } from "../table.js";
import { BotConn } from "./conn.js";
import { TIERS } from "./tiers.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mock bank layer (escrow-aware), mirroring the pattern in the table tests.
function makeWallet(init) {
  const bal = new Map(Object.entries(init));
  const escrow = new Map(); // `${tableId}:${seatNo}` -> { userId, stack }
  return {
    balances: bal,
    escrow,
    async buyIn(uid, amt, tableId, seatNo) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt);
      escrow.set(`${tableId}:${seatNo}`, { userId: uid, stack: amt });
      return b - amt;
    },
    async rebuy(uid, amt, tableId, seatNo) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt);
      const r = escrow.get(`${tableId}:${seatNo}`);
      r.stack += amt;
      return { balance: b - amt, stack: r.stack };
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const key = `${tableId}:${seatNo}`;
      const r = escrow.get(key);
      if (!r) return { balance: expectUserId ? (bal.get(expectUserId) ?? 0) : 0, refunded: 0 };
      const nb = (bal.get(r.userId) ?? 0) + r.stack;
      bal.set(r.userId, nb);
      escrow.delete(key);
      return { balance: nb, refunded: r.stack };
    },
    async syncStacks(tableId, seats) {
      for (const s of seats) {
        const r = escrow.get(`${tableId}:${s.seatNo}`);
        if (r && r.userId === s.userId) r.stack = s.stack;
      }
    },
    // Total chips anywhere in the system — must never change.
    total() {
      let s = 0;
      for (const v of bal.values()) s += v;
      for (const r of escrow.values()) s += r.stack;
      return s;
    }
  };
}

function makeStore() {
  let n = 0;
  return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } };
}

const CFG = { id: "T", name: "Bots", max_seats: 6, small_blind: 5, big_blind: 10, min_buyin: 200, max_buyin: 1000 };

test("bots play full hands at a real table: legal, complete, chip-conserving", async () => {
  const wallet = makeWallet({ b0: 5000, b1: 5000, b2: 5000 });
  const INITIAL = wallet.total();
  const table = new LiveTable(CFG, null, {
    wallet,
    store: makeStore(),
    now: () => 1,
    setTimer: () => 0,      // no auto action-clock / new-hand timer
    clearTimer: () => {},
    rng: mulberry32(0xA11CE), // deterministic deck
    autoStart: false          // we drive beginHand() ourselves
  });

  // Injected scheduler: collect each bot's pending decision so we can pump.
  const pending = [];
  const schedule = (fn) => { pending.push(fn); return null; };

  const illegalErrors = [];
  const specs = [
    { id: "b0", tier: TIERS.reg, seat: 0 },
    { id: "b1", tier: TIERS.fish, seat: 1 },
    { id: "b2", tier: TIERS.reg, seat: 2 }
  ];
  const bots = [];
  for (const s of specs) {
    const bot = new BotConn({
      user: { id: s.id, displayName: s.id },
      tier: s.tier,
      table,
      rng: mulberry32(0xB0 + s.seat),
      schedule
    });
    // Spy for any "illegal action" / "not your turn" bounce-back.
    const origSend = bot.send.bind(bot);
    bot.send = (data) => {
      const m = typeof data === "string" ? JSON.parse(data) : data;
      if (m && m.t === "error" && /illegal|your turn/i.test(m.msg || "")) illegalErrors.push(m.msg);
      return origSend(data);
    };
    table.addWatcher(bot);
    await table.sit(bot, s.seat, 800);
    bots.push(bot);
  }
  assert.equal(table.seats.size, 3, "three bots seated");
  assert.equal(wallet.total(), INITIAL, "buy-ins conserve chips");

  let handsPlayed = 0;
  let showdowns = 0;
  let flopsSeen = 0;
  const MAX_HANDS = 80;
  for (let h = 0; h < MAX_HANDS; h += 1) {
    if (table.eligibleSeats().length < 2) break; // someone(s) busted; game can't continue
    await table.beginHand();
    if (!table.hand) break; // couldn't start (shouldn't happen with >=2 eligible)

    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 5000, "hand failed to terminate — possible action loop");
      if (pending.length === 0) {
        assert.fail("no bot scheduled to act while a hand is live");
      }
      const fn = pending.shift();
      await fn(); // decide + act → next actor scheduled, or the hand finishes
    }
    handsPlayed += 1;
    if (table.resultBoard && table.resultBoard.length >= 3) flopsSeen += 1;
    if (table.result && table.result.type === "showdown") showdowns += 1;

    // Invariant: no chips minted or burned, ever.
    assert.equal(wallet.total(), INITIAL, `chips conserved after hand ${h + 1}`);
    assert.equal(illegalErrors.length, 0, `no illegal actions (hand ${h + 1}): ${illegalErrors[0] || ""}`);
  }

  assert.ok(handsPlayed >= 15, `played a meaningful number of hands (got ${handsPlayed})`);
  assert.ok(flopsSeen >= 3, `bots saw flops, not just preflop folds (got ${flopsSeen})`);
  assert.ok(showdowns >= 1, `bots reached showdown at least once (got ${showdowns})`);
  console.log(`  ${handsPlayed} hands, ${flopsSeen} flops, ${showdowns} showdowns, chips conserved at ${INITIAL}`);
});
