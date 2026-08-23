// The wealthy-bot banker: when no human hosts a blackjack table, a bot sits as
// the house with a deep bankroll (allowed to exceed the table max), covers
// player wins, and is reaped once the humans leave — all chip-conserving.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GameTable } from "../runtime.js";
import { blackjack } from "../games/blackjack.js";
import { BotManager, BOT_EMAIL_DOMAIN } from "./manager.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared bank backing escrow (table) + wallet grants/top-ups (manager).
function makeBank() {
  const bal = new Map();
  const escrow = new Map();
  const granted = new Set();
  return {
    balances: bal, escrow,
    async buyIn(uid, amt, tableId, seatNo) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt); escrow.set(`${tableId}:${seatNo}`, { userId: uid, stack: amt }); return b - amt;
    },
    async rebuy(uid, amt, tableId, seatNo) {
      const b = bal.get(uid) ?? 0; bal.set(uid, b - amt);
      const r = escrow.get(`${tableId}:${seatNo}`); r.stack += amt; return { balance: b - amt, stack: r.stack };
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const r = escrow.get(`${tableId}:${seatNo}`);
      if (!r) return { balance: expectUserId ? (bal.get(expectUserId) ?? 0) : 0, refunded: 0 };
      const nb = (bal.get(r.userId) ?? 0) + r.stack; bal.set(r.userId, nb);
      escrow.delete(`${tableId}:${seatNo}`); return { balance: nb, refunded: r.stack };
    },
    async syncStacks(tableId, seats) {
      for (const s of seats) { const r = escrow.get(`${tableId}:${s.seatNo}`); if (r && r.userId === s.userId) r.stack = s.stack; }
    },
    async getBalance(uid) { return bal.get(uid) ?? 0; },
    async adminAdjust(uid, delta) { bal.set(uid, (bal.get(uid) ?? 0) + delta); return bal.get(uid); },
    async ensureStartingGrant(uid) {
      if (granted.has(uid)) return null; granted.add(uid); bal.set(uid, (bal.get(uid) ?? 0) + 10000); return 10000;
    },
    total() { let s = 0; for (const v of bal.values()) s += v; for (const r of escrow.values()) s += r.stack; return s; }
  };
}

function makeAuth() {
  const byEmail = new Map(); let n = 0;
  return {
    async findUserByEmail(email) { return byEmail.get(email) || null; },
    async createUser(email, _pw, name) { const row = { id: `bot_${n++}`, email, display_name: name }; byEmail.set(email, row); return { id: row.id, email, displayName: name }; }
  };
}

const makeStore = () => { let n = 0; return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } }; };
const makeConn = (id) => ({ user: { id, displayName: id }, watching: new Set(), send() {} });
const CFG = { id: "BJ", name: "BJ", variant: "blackjack", max_seats: 6, small_blind: 10, big_blind: 10, min_buyin: 100, max_buyin: 500 };

test("a wealthy bot banks the table, covers wins, and is reaped when humans leave", async () => {
  const bank = makeBank();
  bank.balances.set("p1", 1000);
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(9), schedule: () => null });
  const table = new GameTable(CFG, null, {
    wallet: bank, store: makeStore(), game: blackjack,
    now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(0xBA), autoStart: false
  });

  // No human wants to host → a wealthy bot banks.
  const banker = await mgr.attachBanker(table);
  assert.ok(banker, "bot banker attached");
  const bankerSeat = table.seatForUser(banker.user.id);
  assert.equal(table.bankerSeat, bankerSeat.seat, "bankerSeat points at the bot");
  assert.ok(bankerSeat.stack > CFG.max_buyin, "house bankroll exceeds the table max");
  assert.match(bankerSeat.name, /House/, "seat labeled as the House");

  const INITIAL = bank.total();

  // A human sits and plays several rounds against the house.
  const p1 = makeConn("p1");
  table.addWatcher(p1);
  await table.sit(p1, table.bankerSeat === 0 ? 1 : 0, 400);
  const playerSeat = table.seatForUser("p1").seat;

  let rounds = 0;
  for (let r = 0; r < 15 && table._canStartRound(); r += 1) {
    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 300, "round terminates");
      const seat = blackjack.actorSeat(table.hand);
      const menu = blackjack.legalActions(table.hand);
      await table.act(p1, menu.actions.some((a) => a.type === "bet") ? { type: "bet", amount: 25 } : { type: "stand" });
    }
    rounds += 1;
    assert.equal(bank.total(), INITIAL, `chips conserved after round ${r + 1}`);
  }
  assert.ok(rounds >= 5, `played rounds (${rounds})`);

  // Player leaves → only the bot banker remains → reap it so the table can close.
  await table.stand(p1);
  table.removeWatcher(p1);
  const reaped = await mgr.reapIfNoHumans(table);
  assert.ok(reaped, "bot banker reaped once no humans remain");
  assert.equal(table.seats.size, 0, "table emptied");
  assert.equal(bank.total(), INITIAL, "reap conserves chips");
  void playerSeat; void BOT_EMAIL_DOMAIN;
});
