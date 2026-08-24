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

// The adaptive "pro" tier learns from the SAME public frames a human sees: it
// diffs each opponent's lastAction label across TABLE_STATE broadcasts into
// per-opponent observations (BotConn._observeFromView). This proves that live
// path feeds the model — self-play feeds it from engine state instead, so the
// frame-parsing code is only exercised here.
test("an adaptive pro bot accumulates opponent reads from live table frames", async () => {
  const wallet = makeWallet({ b0: 5000, b1: 5000, b2: 5000 });
  const table = new LiveTable(CFG, null, {
    wallet, store: makeStore(),
    now: () => 1, setTimer: () => 0, clearTimer: () => {},
    rng: mulberry32(0xC0FFEE), autoStart: false
  });
  const pending = [];
  const schedule = (fn) => { pending.push(fn); return null; };
  const specs = [
    { id: "b0", tier: TIERS.pro, seat: 0 },   // the adaptive bot
    { id: "b1", tier: TIERS.reg, seat: 1 },
    { id: "b2", tier: TIERS.fish, seat: 2 }
  ];
  const bots = {};
  for (const s of specs) {
    const bot = new BotConn({ user: { id: s.id, displayName: s.id }, tier: s.tier, table, rng: mulberry32(0xD0 + s.seat), schedule });
    table.addWatcher(bot);
    await table.sit(bot, s.seat, 800);
    bots[s.id] = bot;
  }
  const pro = bots.b0;
  assert.ok(pro._model, "the pro tier gets an opponent model");
  assert.equal(bots.b1._model, null, "non-adaptive tiers get no model");

  for (let h = 0; h < 40 && table.eligibleSeats().length >= 2; h += 1) {
    await table.beginHand();
    if (!table.hand) break;
    let guard = 0;
    while (table.hand) { assert.ok(guard++ < 5000); if (!pending.length) break; await pending.shift()(); }
  }

  // It observed BOTH opponents (never itself) and built real confidence.
  const r1 = pro._model.read("b1");
  const r2 = pro._model.read("b2");
  assert.ok(r1.n >= 3, `observed b1's actions (n=${r1.n})`);
  assert.ok(r2.n >= 3, `observed b2's actions (n=${r2.n})`);
  assert.ok(r1.kappa > 0 && r2.kappa > 0, "confidence rose above zero");
  assert.equal(pro._model.read("b0").n, 0, "never observes itself");
  console.log(`  pro read b1 n=${r1.n} vpip=${r1.vpip.toFixed(2)}, b2 n=${r2.n} vpip=${r2.vpip.toFixed(2)}`);
});

// Bots read the table's variant and drive their equity sim off it, so the whole
// stack (deck, hole count, showdown eval, pot-limit) must work for non-Hold'em
// games too. Play a short sample of PLO and Short Deck and assert correctness.
test("bots play non-Hold'em variants end to end (PLO, Short Deck)", async () => {
  for (const [variant, holeCount] of [["plo", 4], ["shortdeck", 2]]) {
    const wallet = makeWallet({ b0: 5000, b1: 5000 });
    const INITIAL = wallet.total();
    const table = new LiveTable({ ...CFG, id: variant, variant }, null, {
      wallet, store: makeStore(),
      now: () => 1, setTimer: () => 0, clearTimer: () => {},
      rng: mulberry32(0x5EED), autoStart: false
    });
    const pending = [];
    const bots = [];
    for (const seat of [0, 1]) {
      const bot = new BotConn({
        user: { id: `b${seat}`, displayName: `b${seat}` },
        tier: TIERS.reg, table, rng: mulberry32(0x30 + seat),
        schedule: (fn) => { pending.push(fn); return null; }
      });
      table.addWatcher(bot);
      await table.sit(bot, seat, 800);
      bots.push(bot);
    }

    let hands = 0;
    for (let h = 0; h < 20 && table.eligibleSeats().length >= 2; h += 1) {
      await table.beginHand();
      // Bots learned their hole count from the private frame the deal pushed.
      for (const bot of bots) assert.equal(bot.hole.length, holeCount, `${variant} deals ${holeCount}`);
      let guard = 0;
      while (table.hand) {
        assert.ok(guard++ < 5000, `${variant} hand terminates`);
        if (!pending.length) assert.fail(`${variant}: a bot should be scheduled`);
        await pending.shift()();
      }
      hands += 1;
      assert.equal(wallet.total(), INITIAL, `${variant} conserves chips (hand ${h + 1})`);
    }
    // Short deck's variance can bust a heads-up match fast; a few clean hands
    // (correct hole counts + conserved chips, asserted per hand above) is enough
    // to prove the whole stack drives the variant correctly.
    assert.ok(hands >= 3, `${variant}: played hands (${hands})`);
    console.log(`  ${variant}: ${hands} hands, chips conserved at ${INITIAL}`);
  }
});
