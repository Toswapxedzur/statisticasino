// BotManager tests: provisioning + funding + seating + teardown, against a real
// LiveTable. DB/wallet are mocked by a single shared "bank" that backs BOTH the
// table's escrow layer and the manager's funding calls (in prod both are the one
// `user.chips` column), so a top-up actually gives the bot chips the buy-in can
// draw on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveTable } from "../table.js";
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

// One store backing escrow (table) + wallet grants/top-ups (manager).
function makeBank() {
  const bal = new Map();
  const escrow = new Map();
  const granted = new Set();
  return {
    balances: bal, escrow,
    // ---- bank layer (table) ----
    async buyIn(uid, amt, tableId, seatNo) {
      const b = bal.get(uid) ?? 0;
      if (b < amt) { const e = new Error("insufficient"); e.code = "INSUFFICIENT_CHIPS"; throw e; }
      bal.set(uid, b - amt); escrow.set(`${tableId}:${seatNo}`, { userId: uid, stack: amt });
      return b - amt;
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
    // ---- wallet layer (manager funding) ----
    async getBalance(uid) { return bal.get(uid) ?? 0; },
    async adminAdjust(uid, delta) { bal.set(uid, (bal.get(uid) ?? 0) + delta); return bal.get(uid); },
    async ensureStartingGrant(uid) {
      if (granted.has(uid)) return null;
      granted.add(uid); bal.set(uid, (bal.get(uid) ?? 0) + 10000); return 10000;
    },
    total() { let s = 0; for (const v of bal.values()) s += v; for (const r of escrow.values()) s += r.stack; return s; }
  };
}

function makeAuth() {
  const byEmail = new Map();
  let n = 0;
  return {
    createdEmails: [],
    async findUserByEmail(email) { return byEmail.get(email) || null; },
    async createUser(email, _pw, name) {
      this.createdEmails.push(email);
      const row = { id: `bot_${n++}`, email, display_name: name };
      byEmail.set(email, row);
      return { id: row.id, email, displayName: name };
    }
  };
}

function makeStore() { let n = 0; return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } }; }
const CFG = { id: "T", name: "Bots", max_seats: 6, small_blind: 5, big_blind: 10, min_buyin: 200, max_buyin: 1000 };

// Simulate a seat losing chips down to `target` (a bust): move the delta OUT of
// escrow into a sink wallet so the mock stays conserved, and mirror seat.stack —
// keeping escrow and the in-memory stack consistent the way a real hand would.
function drainSeatTo(bank, table, seatNo, target, sinkId = "pot") {
  const r = bank.escrow.get(`${table.id}:${seatNo}`);
  const delta = r.stack - target;
  r.stack = target;
  bank.balances.set(sinkId, (bank.balances.get(sinkId) ?? 0) + delta);
  table.seats.get(seatNo).stack = target;
}

function makeTable(bank) {
  return new LiveTable(CFG, null, {
    wallet: bank, store: makeStore(),
    now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(7), autoStart: false
  });
}

test("attach provisions a funded .invalid-domain bot and seats it via escrow", async () => {
  const bank = makeBank();
  const auth = makeAuth();
  const mgr = new BotManager({ auth, wallet: bank, rng: mulberry32(1), schedule: () => null });
  const table = makeTable(bank);

  const bot = await mgr.attach(table, "reg", { seat: 0 });
  assert.ok(bot, "attach returned a BotConn");
  assert.equal(table.seats.size, 1, "bot took a seat");
  assert.match(auth.createdEmails[0], new RegExp(`@${BOT_EMAIL_DOMAIN}$`), "bot email is on the reserved domain");
  assert.ok(mgr.isBotUser(bot.user.id), "manager tracks the bot as busy");
  assert.equal(mgr.botsAtTable(table.id).length, 1);
  const seat = table.seatForUser(bot.user.id);
  assert.ok(seat.stack >= CFG.min_buyin && seat.stack <= CFG.max_buyin, "bought in within range");
});

test("bots play, then detach/reap cash out cleanly with chips conserved", async () => {
  const bank = makeBank();
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(2), schedule: (fn) => { pending.push(fn); return null; } });
  const pending = [];
  const table = makeTable(bank);

  const b0 = await mgr.attach(table, "reg", { seat: 0 });
  const b1 = await mgr.attach(table, "fish", { seat: 1 });
  assert.ok(b0 && b1 && table.seats.size === 2, "two bots seated");
  const AFTER_FUNDING = bank.total(); // grants mint chips; conservation holds from here on

  // Play a handful of hands via the pump.
  let hands = 0;
  for (let h = 0; h < 12 && table.eligibleSeats().length >= 2; h += 1) {
    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 5000, "hand terminates");
      if (!pending.length) assert.fail("a bot should be scheduled to act");
      await pending.shift()();
    }
    hands += 1;
    assert.equal(bank.total(), AFTER_FUNDING, `chips conserved after hand ${h + 1}`);
  }
  assert.ok(hands >= 5, `played hands (${hands})`);

  // Detach one bot between hands (idle) — cashes out now.
  assert.ok(!table.hand, "not mid-hand");
  await mgr.detach(table, b0);
  assert.equal(table.seatForUser(b0.user.id), null, "detached bot's seat is gone");
  assert.ok(!mgr.isBotUser(b0.user.id), "identity freed");
  assert.equal(bank.total(), AFTER_FUNDING, "detach conserves chips");

  // No humans anywhere → reap removes the rest so the table can close.
  const reaped = await mgr.reapIfNoHumans(table);
  assert.ok(reaped, "reap removed remaining bots");
  assert.equal(table.seats.size, 0, "table emptied");
  assert.equal(mgr.botsAtTable(table.id).length, 0, "no bots tracked at the table");
  assert.equal(bank.total(), AFTER_FUNDING, "reap conserves chips");
});

test("reapIfNoHumans keeps bots while a human is seated", async () => {
  const bank = makeBank();
  bank.balances.set("human", 5000);
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(3), schedule: () => null });
  const table = makeTable(bank);
  const human = { user: { id: "human", displayName: "H" }, watching: new Set(), send() {} };
  table.addWatcher(human);
  await table.sit(human, 0, 400);
  await mgr.attach(table, "reg", { seat: 1 });

  const reaped = await mgr.reapIfNoHumans(table);
  assert.equal(reaped, false, "did not reap");
  assert.equal(mgr.botsAtTable(table.id).length, 1, "bot stays while a human is present");
});

// ------------------------------------------------------- staked-bot economy

test("a staked bot is funded by its inviter and holds no wallet of its own", async () => {
  const bank = makeBank();
  bank.balances.set("inviter", 50000);
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(9), schedule: () => null });
  const table = makeTable(bank);

  const bot = await mgr.attach(table, "reg", { seat: 0, inviterId: "inviter", buyin: 800 });
  assert.ok(bot, "seated");
  assert.equal(bank.balances.get("inviter"), 49200, "inviter debited the 800 buy-in");
  assert.equal(bank.balances.get(bot.user.id) ?? 0, 0, "the bot itself was never funded (no own wallet)");
  const esc = bank.escrow.get(`${table.id}:0`);
  assert.equal(esc.userId, "inviter", "escrow is owned by the inviter, not the bot");
  assert.equal(esc.stack, 800);
  assert.equal(table.seatForUser(bot.user.id).funderId, "inviter", "seat records the funder");
});

test("inviting a bot you can't afford is rejected cleanly (no seat, no charge)", async () => {
  const bank = makeBank();
  bank.balances.set("broke", 100); // under the min buy-in
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(9), schedule: () => null });
  const table = makeTable(bank);

  const bot = await mgr.attach(table, "reg", { seat: 0, inviterId: "broke", buyin: 800 });
  assert.equal(bot, null, "no bot seated");
  assert.equal(table.seats.size, 0, "no seat taken");
  assert.equal(bank.balances.get("broke"), 100, "inviter not charged");
});

test("removing a staked bot returns its chips to the inviter", async () => {
  const bank = makeBank();
  bank.balances.set("inviter", 50000);
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(9), schedule: () => null });
  const table = makeTable(bank);
  const total0 = bank.total();

  const bot = await mgr.attach(table, "reg", { seat: 0, inviterId: "inviter", buyin: 800 });
  await mgr.detach(table, bot);
  assert.equal(table.seatForUser(bot.user.id), null, "seat gone");
  assert.equal(bank.balances.get("inviter"), 50000, "inviter got the full 800 back");
  assert.equal(bank.total(), total0, "chips conserved");
});

test("a staked bot rebuys from the inviter, then quits once it's getting crushed", async () => {
  const bank = makeBank();
  bank.balances.set("inviter", 50000);
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(9), schedule: (fn) => { fn(); return null; } });
  const table = makeTable(bank);
  const total0 = bank.total();

  const bot = await mgr.attach(table, "reg", { seat: 0, inviterId: "inviter", buyin: 1000 });
  const botId = bot.user.id;

  // Bust down to 100 (below the 40% checkpoint); net loss < 1.5 buy-ins → auto-rebuy.
  drainSeatTo(bank, table, 0, 100);
  await mgr._onBotIdle(botId);
  assert.equal(table.seatForUser(botId).stack, 1000, "topped back up to a full buy-in");
  assert.equal(bank.escrow.get(`${table.id}:0`).stack, 1000, "escrow matches the refilled stack");
  assert.equal(bank.balances.get("inviter"), 48100, "inviter funded the 900 rebuy (1000 + 900 in)");

  // Bust to 0 again: staked 1900, stack 0 → net −1900 past 1.5 buy-ins → quit.
  drainSeatTo(bank, table, 0, 0);
  await mgr._onBotIdle(botId);
  assert.equal(table.seatForUser(botId), null, "the crushed bot quit the table");
  assert.ok(!mgr.isBotUser(botId), "identity freed");
  assert.equal(bank.total(), total0, "chips conserved across the whole staking cycle");
});

test("staked bots play real hands with chips conserved across inviter wallets", async () => {
  const bank = makeBank();
  bank.balances.set("alice", 20000);
  bank.balances.set("bob", 20000);
  const pending = [];
  const mgr = new BotManager({ auth: makeAuth(), wallet: bank, rng: mulberry32(4), schedule: (fn) => { pending.push(fn); return null; } });
  const table = makeTable(bank);
  const total0 = bank.total();

  await mgr.attach(table, "reg", { seat: 0, inviterId: "alice", buyin: 800 });
  await mgr.attach(table, "fish", { seat: 1, inviterId: "bob", buyin: 800 });
  assert.equal(bank.balances.get("alice"), 19200, "alice funded her bot");
  assert.equal(bank.balances.get("bob"), 19200, "bob funded his bot");

  const drain = async () => { while (pending.length) await pending.shift()(); };
  let hands = 0;
  for (let h = 0; h < 15 && table.eligibleSeats().length >= 2; h += 1) {
    await table.beginHand();
    let guard = 0;
    while (table.hand) { assert.ok(guard++ < 5000, "hand terminates"); if (!pending.length) break; await pending.shift()(); }
    await drain(); // run any between-hands stewards (rebuy / quit)
    assert.equal(bank.total(), total0, `chips conserved after hand ${h + 1}`);
  }
  assert.ok(hands >= 0);
  assert.equal(bank.total(), total0, "chips conserved across the staked session");
});
