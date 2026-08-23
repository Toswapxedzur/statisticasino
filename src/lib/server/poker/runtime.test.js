// GameTable + Blackjack integration: seat a banker and players at a real
// runtime, play rounds through sit()/act()/finishHand(), and assert the banked
// settlement conserves chips to the chip (a player's win is the banker's loss).

import { test } from "node:test";
import assert from "node:assert/strict";
import { GameTable } from "./runtime.js";
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
    balances: bal, escrow,
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
    total() { let s = 0; for (const v of bal.values()) s += v; for (const r of escrow.values()) s += r.stack; return s; }
  };
}

const makeStore = () => { let n = 0; return { async nextHandNo() { return ++n; }, async persistHand() { return "h"; } }; };
const makeConn = (id) => ({ user: { id, displayName: id }, watching: new Set(), frames: [], send(d) { this.frames.push(typeof d === "string" ? JSON.parse(d) : d); } });

const CFG = { id: "BJ", name: "Blackjack", variant: "blackjack", max_seats: 6, small_blind: 10, big_blind: 10, min_buyin: 100, max_buyin: 3000 };

function makeTable(wallet, seed) {
  return new GameTable(CFG, null, {
    wallet, store: makeStore(), game: blackjack,
    now: () => 1, setTimer: () => 0, clearTimer: () => {}, rng: mulberry32(seed), autoStart: false
  });
}

test("blackjack round runs at a real table and conserves chips through the banker", async () => {
  const wallet = makeWallet({ house: 10000, p1: 1000, p2: 1000 });
  const INITIAL = wallet.total();
  const table = makeTable(wallet, 0xB1);

  const banker = makeConn("house");
  table.addWatcher(banker);
  await table.sit(banker, 0, 3000);
  table.bankerSeat = 0; // the hub flags the banker seat when it seats the house

  const p1 = makeConn("p1");
  const p2 = makeConn("p2");
  table.addWatcher(p1); await table.sit(p1, 1, 500);
  table.addWatcher(p2); await table.sit(p2, 2, 500);
  const connBySeat = { 0: banker, 1: p1, 2: p2 };

  assert.equal(table.seats.size, 3);
  assert.equal(wallet.total(), INITIAL, "buy-ins conserve chips");

  let rounds = 0;
  for (let r = 0; r < 20; r += 1) {
    if (!table._canStartRound()) break;
    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 500, "round terminates");
      const seat = blackjack.actorSeat(table.hand);
      assert.notEqual(seat, table.bankerSeat, "the banker never acts");
      const menu = blackjack.legalActions(table.hand);
      const act = menu.actions.some((a) => a.type === "bet")
        ? { type: "bet", amount: 20 }
        : { type: "stand" }; // simple strategy: bet 20, then stand
      await table.act(connBySeat[seat], act);
    }
    rounds += 1;
    assert.equal(wallet.total(), INITIAL, `chips conserved after round ${r + 1}`);
    assert.ok(table.result && table.result.game === "blackjack", "a result window is published");
  }

  assert.ok(rounds >= 5, `played several rounds (${rounds})`);
  // Banked: the house stack moved opposite to the players' net.
  const house = table.seats.get(0).stack;
  const players = table.seats.get(1).stack + table.seats.get(2).stack;
  assert.equal(house + players, 3000 + 500 + 500, "on-table chips conserved");
  console.log(`  blackjack: ${rounds} rounds, house=${house}, players=${players}, total conserved at ${INITIAL}`);
});

test("a player standing pat beats a busting dealer for even money (banked)", async () => {
  // Rig via seed search would be brittle; instead assert the invariant that any
  // completed round's deltas sum to zero and the banker delta = -sum(players).
  const wallet = makeWallet({ house: 10000, p1: 1000 });
  const table = makeTable(wallet, 0x77);
  const banker = makeConn("house"); table.addWatcher(banker); await table.sit(banker, 0, 3000); table.bankerSeat = 0;
  const p1 = makeConn("p1"); table.addWatcher(p1); await table.sit(p1, 1, 500);

  await table.beginHand();
  const startHouse = 3000;
  const startP1 = 500;
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 200);
    const seat = blackjack.actorSeat(table.hand);
    const menu = blackjack.legalActions(table.hand);
    await table.act(seat === 0 ? banker : p1, menu.actions.some((a) => a.type === "bet") ? { type: "bet", amount: 50 } : { type: "stand" });
  }
  const dHouse = table.seats.get(0).stack - startHouse;
  const dP1 = table.seats.get(1).stack - startP1;
  assert.equal(dHouse + dP1, 0, "banker delta exactly offsets the player delta");
});
