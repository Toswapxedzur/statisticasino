// Three Card Poker bot: the Q-6-4 play/fold rule + a full integration (bot
// players + a bot banker play rounds at a real GameTable, chips conserved).

import { test } from "node:test";
import assert from "node:assert/strict";
import { threeCardStrategy, TC_TIERS } from "./three-card-strategy.js";
import { GameTable } from "../runtime.js";
import { threeCard } from "../games/three-card.js";
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
const dec = (cards) => ({ view: { round: { hands: [{ seat: 1, cards }] } }, turn: { phase: "decision", actions: [{ type: "fold" }, { type: "play", amount: 10 }] }, seat: 1 });

test("plays Q-6-4 or better, folds below (basic)", () => {
  assert.equal(threeCardStrategy.decide({ ...dec(["Ks", "5d", "2c"]), tier: TC_TIERS.basic }).type, "play", "K-high beats Q64");
  assert.equal(threeCardStrategy.decide({ ...dec(["Qs", "5d", "2c"]), tier: TC_TIERS.basic }).type, "fold", "Q-5-2 is below Q-6-4");
  assert.equal(threeCardStrategy.decide({ ...dec(["Qs", "5d", "2c"]), tier: TC_TIERS.loose }).type, "play", "loose always plays");
  assert.equal(threeCardStrategy.decide({ ...dec(["2s", "2d", "9c"]), tier: TC_TIERS.tight }).type, "play", "tight plays a pair");
});

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
const CFG = { id: "TC", name: "TC", variant: "three-card", max_seats: 6, small_blind: 5, big_blind: 5, min_buyin: 100, max_buyin: 4000 };

test("bot players + bot banker play Three Card Poker, chips conserved", async () => {
  const bank = makeBank();
  const pending = [];
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(4), schedule: (fn) => { pending.push(fn); return null; } });
  const table = new GameTable(CFG, null, { wallet: bank, store: makeStore(), game: threeCard, now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(0x3CA), autoStart: false });
  await mgr.attachBanker(table);
  assert.ok(await mgr.attach(table, "basic"));
  assert.ok(await mgr.attach(table, "loose"));
  const INITIAL = bank.total();
  let rounds = 0;
  for (let r = 0; r < 30 && table._canStartRound(); r += 1) {
    await table.beginHand();
    let g = 0;
    while (table.hand) { assert.ok(g++ < 500); if (!pending.length) assert.fail("bot should act"); await pending.shift()(); }
    rounds += 1;
    assert.equal(bank.total(), INITIAL, `conserved after round ${r + 1}`);
  }
  assert.ok(rounds >= 10, `rounds (${rounds})`);
  console.log(`  three-card: ${rounds} rounds, conserved at ${INITIAL}`);
});
