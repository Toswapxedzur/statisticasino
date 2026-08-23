// Blackjack bot tests: the basic-strategy lookup on canonical cells + the
// aggressive/timid personalities, then a full integration where bot players +
// a bot banker play many rounds at a real GameTable (legal, complete, conserved,
// and the aggressive style demonstrably busts more than basic).

import { test } from "node:test";
import assert from "node:assert/strict";
import { blackjackStrategy, BJ_TIERS } from "./blackjack-strategy.js";
import { GameTable } from "../runtime.js";
import { blackjack } from "../games/blackjack.js";
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

// -------------------------------------------------------- unit: basic strategy

function acting(myCards, dealerUp, { double = false, surrender = false } = {}) {
  const actions = [{ type: "hit" }, { type: "stand" }];
  if (double) actions.push({ type: "double" });
  if (surrender) actions.push({ type: "surrender" });
  return {
    view: { round: { hands: [{ seat: 1, cards: myCards }], dealer: { cards: [dealerUp, "??"] } } },
    turn: { phase: "acting", actions },
    seat: 1
  };
}
const play = (ctx, tier = BJ_TIERS.basic) => blackjackStrategy.decide({ ...ctx, tier }).type;

test("basic strategy: canonical hard/soft cells", () => {
  assert.equal(play(acting(["Kc", "6d"], "Th")), "hit", "hard 16 vs 10 → hit");
  assert.equal(play(acting(["7c", "5d"], "6h")), "stand", "hard 12 vs 6 → stand");
  assert.equal(play(acting(["7c", "5d"], "2h")), "hit", "hard 12 vs 2 → hit");
  assert.equal(play(acting(["9c", "4d"], "7h")), "hit", "hard 13 vs 7 → hit");
  assert.equal(play(acting(["Kc", "Kd"], "Ah")), "stand", "hard 20 → stand");
  assert.equal(play(acting(["9c", "8d"], "5h")), "stand", "hard 17 → stand");
});

test("basic strategy: doubles (with fallback when not allowed)", () => {
  assert.equal(play(acting(["6c", "5d"], "6h", { double: true })), "double", "11 vs 6 → double");
  assert.equal(play(acting(["6c", "5d"], "6h")), "hit", "11 vs 6, no double → hit");
  assert.equal(play(acting(["Ac", "7d"], "6h", { double: true })), "double", "soft 18 vs 6 → double");
  assert.equal(play(acting(["Ac", "7d"], "6h")), "stand", "soft 18 vs 6, no double → stand");
  assert.equal(play(acting(["Ac", "7d"], "9h")), "hit", "soft 18 vs 9 → hit");
});

test("basic strategy: late surrender when offered", () => {
  assert.equal(play(acting(["Kc", "6d"], "Th", { surrender: true })), "surrender", "16 vs 10 → surrender");
  assert.equal(play(acting(["Kc", "6d"], "6h", { surrender: true })), "stand", "16 vs 6 → stand (not surrender)");
});

test("personalities differ from basic on stiff hands", () => {
  // 16 vs 6: basic stands, aggressive hits (chases), timid stands.
  assert.equal(play(acting(["Kc", "6d"], "6h"), BJ_TIERS.basic), "stand");
  assert.equal(play(acting(["Kc", "6d"], "6h"), BJ_TIERS.aggressive), "hit");
  // 13 vs 10: basic hits, timid stands (never busts a stiff), aggressive hits.
  assert.equal(play(acting(["9c", "4d"], "Th"), BJ_TIERS.timid), "stand");
  assert.equal(play(acting(["9c", "4d"], "Th"), BJ_TIERS.aggressive), "hit");
});

test("betting: flat min for basic, bigger for aggressive", () => {
  const betting = { view: {}, turn: { phase: "betting", actions: [{ type: "bet", min: 10, max: 500 }] }, seat: 1 };
  assert.deepEqual(blackjackStrategy.decide({ ...betting, tier: BJ_TIERS.basic }), { type: "bet", amount: 10 });
  assert.deepEqual(blackjackStrategy.decide({ ...betting, tier: BJ_TIERS.aggressive }), { type: "bet", amount: 30 });
});

// -------------------------------------------------------- integration

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
const CFG = { id: "BJ", name: "BJ", variant: "blackjack", max_seats: 6, small_blind: 1, big_blind: 1, min_buyin: 50, max_buyin: 4000 };

test("bot players + bot banker play blackjack: legal, conserved, aggressive busts more", async () => {
  const bank = makeBank();
  const pending = [];
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(5), schedule: (fn) => { pending.push(fn); return null; } });
  const table = new GameTable(CFG, null, {
    wallet: bank, store: makeStore(), game: blackjack,
    now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(0xB1A), autoStart: false
  });

  await mgr.attachBanker(table);
  const basicBot = await mgr.attach(table, "basic");
  const aggroBot = await mgr.attach(table, "aggressive");
  assert.ok(basicBot && aggroBot, "two player bots + banker seated");
  const basicSeat = table.seatForUser(basicBot.user.id).seat;
  const aggroSeat = table.seatForUser(aggroBot.user.id).seat;
  const INITIAL = bank.total();

  const bust = { [basicSeat]: 0, [aggroSeat]: 0 };
  let rounds = 0;
  for (let r = 0; r < 80 && table._canStartRound(); r += 1) {
    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 500, "round terminates");
      if (!pending.length) assert.fail("a bot should be scheduled to act");
      await pending.shift()();
    }
    rounds += 1;
    assert.equal(bank.total(), INITIAL, `chips conserved after round ${r + 1}`);
    for (const h of table.result.hands || []) if (h.bust) bust[h.seat] += 1;
  }

  assert.ok(rounds >= 20, `played rounds (${rounds})`);
  assert.ok(
    bust[aggroSeat] > bust[basicSeat],
    `aggressive busts more than basic (aggro=${bust[aggroSeat]}, basic=${bust[basicSeat]})`
  );
  console.log(`  ${rounds} rounds; busts — aggressive=${bust[aggroSeat]} basic=${bust[basicSeat]}; conserved at ${INITIAL}`);
});
