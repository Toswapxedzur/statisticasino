// Casino Hold'em bot: ante + call/fold heuristic, then a full integration where
// bot players + a bot banker play rounds at a real GameTable (legal, conserved).

import { test } from "node:test";
import assert from "node:assert/strict";
import { casinoHoldemStrategy, CH_TIERS } from "./casino-holdem-strategy.js";
import { GameTable } from "../runtime.js";
import { casinoHoldem } from "../games/casino-holdem.js";
import { BotManager } from "./manager.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decision(hole, flop) {
  return { view: { round: { hands: [{ seat: 1, cards: hole }], community: flop } }, turn: { phase: "decision", actions: [{ type: "fold" }, { type: "call", amount: 20 }] }, seat: 1 };
}

test("bot antes, then calls a made hand and folds junk (basic)", () => {
  const ante = casinoHoldemStrategy.decide({ turn: { phase: "ante", actions: [{ type: "ante", min: 5, max: 100 }] }, seat: 1, tier: CH_TIERS.basic });
  assert.deepEqual(ante, { type: "ante", amount: 5 });

  assert.equal(casinoHoldemStrategy.decide({ ...decision(["As", "Ah"], ["2c", "5d", "9h"]), tier: CH_TIERS.basic }).type, "call", "pair → call");
  assert.equal(casinoHoldemStrategy.decide({ ...decision(["2s", "7d"], ["9c", "Jd", "4h"]), tier: CH_TIERS.basic }).type, "fold", "low junk → fold");
  assert.equal(casinoHoldemStrategy.decide({ ...decision(["2s", "7d"], ["9c", "Jd", "4h"]), tier: CH_TIERS.loose }).type, "call", "loose always calls");
  assert.equal(casinoHoldemStrategy.decide({ ...decision(["As", "7d"], ["9c", "Jd", "4h"]), tier: CH_TIERS.basic }).type, "call", "ace-high → call");
});

// ------- integration
function makeBank() {
  const bal = new Map(); const escrow = new Map(); const granted = new Set();
  return {
    balances: bal, escrow,
    async buyIn(uid, amt, tid, seat) { const b = bal.get(uid) ?? 0; if (b < amt) { const e = new Error("x"); e.code = "INSUFFICIENT_CHIPS"; throw e; } bal.set(uid, b - amt); escrow.set(`${tid}:${seat}`, { userId: uid, stack: amt }); return b - amt; },
    async rebuy(uid, amt, tid, seat) { const b = bal.get(uid) ?? 0; bal.set(uid, b - amt); const r = escrow.get(`${tid}:${seat}`); r.stack += amt; return { balance: b - amt, stack: r.stack }; },
    async cashOut(tid, seat, exp = null) { const r = escrow.get(`${tid}:${seat}`); if (!r) return { balance: exp ? (bal.get(exp) ?? 0) : 0, refunded: 0 }; const nb = (bal.get(r.userId) ?? 0) + r.stack; bal.set(r.userId, nb); escrow.delete(`${tid}:${seat}`); return { balance: nb, refunded: r.stack }; },
    async syncStacks(tid, seats) { for (const s of seats) { const r = escrow.get(`${tid}:${s.seatNo}`); if (r && r.userId === s.userId) r.stack = s.stack; } },
    async getBalance(uid) { return bal.get(uid) ?? 0; },
    async adminAdjust(uid, d) { bal.set(uid, (bal.get(uid) ?? 0) + d); return bal.get(uid); },
    async ensureStartingGrant(uid) { if (granted.has(uid)) return null; granted.add(uid); bal.set(uid, (bal.get(uid) ?? 0) + 10000); return 10000; },
    total() { let s = 0; for (const v of bal.values()) s += v; for (const r of escrow.values()) s += r.stack; return s; }
  };
}
function makeAuth() { const m = new Map(); let n = 0; return { async findUserByEmail(e) { return m.get(e) || null; }, async createUser(e, _p, nm) { const r = { id: `bot_${n++}`, email: e, display_name: nm }; m.set(e, r); return { id: r.id, email: e, displayName: nm }; } }; }
const makeStore = () => { let n = 0; return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } }; };
const CFG = { id: "CH", name: "CH", variant: "casino-holdem", max_seats: 6, small_blind: 5, big_blind: 5, min_buyin: 100, max_buyin: 4000 };

test("bot players + bot banker play Casino Hold'em, chips conserved", async () => {
  const bank = makeBank();
  const pending = [];
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(3), schedule: (fn) => { pending.push(fn); return null; } });
  const table = new GameTable(CFG, null, {
    wallet: bank, store: makeStore(), game: casinoHoldem,
    now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(0xCA5), autoStart: false
  });

  await mgr.attachBanker(table);
  const b1 = await mgr.attach(table, "basic");
  const b2 = await mgr.attach(table, "loose");
  assert.ok(b1 && b2, "two player bots + banker");
  const INITIAL = bank.total();

  let rounds = 0;
  for (let r = 0; r < 30 && table._canStartRound(); r += 1) {
    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 500, "round terminates");
      if (!pending.length) assert.fail("a bot should be scheduled");
      await pending.shift()();
    }
    rounds += 1;
    assert.equal(bank.total(), INITIAL, `chips conserved after round ${r + 1}`);
  }
  assert.ok(rounds >= 10, `played rounds (${rounds})`);
  console.log(`  casino-holdem: ${rounds} rounds, conserved at ${INITIAL}`);
});
