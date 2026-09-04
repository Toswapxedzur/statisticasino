// Universal match recording: a full GameTable round must persist one
// well-formed replay (deterministic inputs + action log + results) through
// store.persistReplay, with the banker role split out and nets summing to zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GameTable } from "./runtime.js";
import { LiveTable } from "./table.js";
import { legalActions } from "./engine/index.js";
import { blackjack } from "./games/blackjack.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWallet(init) {
  const bal = new Map(Object.entries(init));
  const escrow = new Map();
  return {
    async buyIn(uid, amt, tableId, seatNo) {
      bal.set(uid, (bal.get(uid) ?? 0) - amt);
      escrow.set(`${tableId}:${seatNo}`, { userId: uid, stack: amt });
      return bal.get(uid);
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const r = escrow.get(`${tableId}:${seatNo}`);
      if (!r) return { balance: 0, refunded: 0 };
      escrow.delete(`${tableId}:${seatNo}`);
      return { balance: (bal.get(r.userId) ?? 0) + r.stack, refunded: r.stack };
    },
    async syncStacks() {}
  };
}

test("a completed banked round persists a replayable record", async () => {
  const replays = [];
  const store = {
    _n: 0,
    async nextHandNo() { return ++this._n; },
    async persistHand() { return "h"; },
    async persistReplay(r) { replays.push(r); return "r1"; }
  };
  const table = new GameTable(
    { id: "BJ", name: "Blackjack", variant: "blackjack", max_seats: 6, small_blind: 10, big_blind: 10, min_buyin: 100, max_buyin: 3000 },
    null,
    { wallet: makeWallet({ house: 10000, p1: 1000 }), store, game: blackjack, now: () => 1000, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(7), autoStart: false }
  );
  const conn = (id) => ({ user: { id, displayName: id }, watching: new Set(), frames: [], send() {} });
  const banker = conn("house"); table.addWatcher(banker); await table.sit(banker, 0, 3000); table.bankerSeat = 0;
  const p1 = conn("p1"); table.addWatcher(p1); await table.sit(p1, 1, 500);

  await table.beginHand();
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 200);
    const seat = blackjack.actorSeat(table.hand);
    const menu = blackjack.legalActions(table.hand);
    await table.act(seat === 0 ? banker : p1,
      menu.actions.some((a) => a.type === "bet") ? { type: "bet", amount: 50 } : { type: "stand" });
  }

  assert.equal(replays.length, 1, "exactly one replay persisted");
  const r = replays[0];
  assert.equal(r.mode, "blackjack");
  assert.equal(r.context, "cash");
  assert.equal(r.handNo, 1);
  // participants: banker role split out, nets sum to zero
  assert.equal(r.players.length, 2);
  const bankerRow = r.players.find((p) => p.role === "banker");
  assert.ok(bankerRow && bankerRow.userId === "house");
  assert.equal(r.players.reduce((s, p) => s + p.net, 0), 0, "nets conserve chips");
  // replay document: deterministic inputs + the action log
  assert.equal(r.replay.v, 1);
  assert.ok(Array.isArray(r.replay.deck) && r.replay.deck.length > 0, "initial deck recorded");
  assert.ok(r.replay.actions.length >= 1, "actions recorded");
  assert.ok(r.replay.actions.every((a) => typeof a.s === "number" && typeof a.type === "string"));
  assert.ok(r.replay.final && r.replay.final.result, "final outcome summary present");
});

test("a bot-only round is not persisted", async () => {
  const replays = [];
  const store = {
    _n: 0,
    async nextHandNo() { return ++this._n; },
    async persistReplay(r) { replays.push(r); }
  };
  // hub with a botManager that flags every user as a bot
  const hub = { botManager: { isBotUser: () => true } };
  const table = new GameTable(
    { id: "BJ2", name: "Blackjack", variant: "blackjack", max_seats: 6, small_blind: 10, big_blind: 10, min_buyin: 100, max_buyin: 3000 },
    hub,
    { wallet: makeWallet({ b1: 1000, b2: 1000 }), store, game: blackjack, now: () => 1000, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(9), autoStart: false }
  );
  const conn = (id) => ({ user: { id, displayName: id }, watching: new Set(), frames: [], send() {} });
  const banker = conn("b1"); table.addWatcher(banker); await table.sit(banker, 0, 3000); table.bankerSeat = 0;
  const p = conn("b2"); table.addWatcher(p); await table.sit(p, 1, 500);

  await table.beginHand();
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 200);
    const seat = blackjack.actorSeat(table.hand);
    const menu = blackjack.legalActions(table.hand);
    await table.act(seat === 0 ? banker : p,
      menu.actions.some((a) => a.type === "bet") ? { type: "bet", amount: 50 } : { type: "stand" });
  }
  assert.equal(replays.length, 0, "bot-only rounds are nobody's history");
});

test("a completed hold'em hand persists a replayable record (deck + actions + result)", async () => {
  const replays = [];
  const store = {
    _n: 0,
    async nextHandNo() { return ++this._n; },
    async persistHand() { return "h"; },
    async persistReplay(r) { replays.push(r); return "r1"; }
  };
  const table = new LiveTable(
    { id: "T1", name: "Test NLHE", variant: "holdem", max_seats: 6, small_blind: 5, big_blind: 10, min_buyin: 100, max_buyin: 2000 },
    null,
    { wallet: makeWallet({ a: 1000, b: 1000 }), store, now: () => 5000, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(42), autoStart: false }
  );
  const conn = (id) => ({ user: { id, displayName: id }, watching: new Set(), frames: [], send() {} });
  const ca = conn("a"); table.addWatcher(ca); await table.sit(ca, 0, 500);
  const cb = conn("b"); table.addWatcher(cb); await table.sit(cb, 1, 500);

  await table.beginHand();
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 200);
    const toAct = table.hand.toActSeat;
    const menu = legalActions(table.hand);
    const action = menu.actions.find((x) => x.type === "check") || menu.actions.find((x) => x.type === "call") || { type: "fold" };
    await table.act(toAct === 0 ? ca : cb, action);
  }

  assert.equal(replays.length, 1);
  const r = replays[0];
  assert.equal(r.mode, "holdem");
  assert.equal(r.variant, "holdem");
  assert.equal(r.context, "cash");
  assert.equal(r.replay.deck.length, 52, "full initial deck order recorded");
  assert.equal(r.replay.config.bigBlind, 10);
  assert.ok(r.replay.actions.length >= 2, "street actions recorded");
  assert.equal(r.players.length, 2);
  assert.equal(r.players.reduce((sum, p) => sum + p.net, 0), 0, "nets conserve chips");
  assert.ok(r.replay.final?.result, "showdown/uncontested summary present");
});
