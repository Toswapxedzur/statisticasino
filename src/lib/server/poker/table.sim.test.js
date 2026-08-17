// Simulation test for LiveTable — the correctness gate for the live table
// server. No DB, no real timers, no network: everything time/DB/random is
// injected via fakes so we can play many full hands deterministically.
//
// Strategy: build a LiveTable with autoStart:false and a manual clock, sit
// several fake players, then drive >= 300 complete hands. On every decision
// we pick a random-but-legal action straight from the engine's legalActions
// (mixing folds/calls/raises/all-ins), or occasionally fire the action timer
// to exercise autoAct. After every hand we assert chip conservation, no
// negative stacks, and that potTotal reconciles.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveTable } from "./table.js";
import { legalActions } from "./engine/index.js";

// ------------------------------------------------------- deterministic rng
// mulberry32 — a tiny seeded PRNG so the whole run is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- fakes

// In-memory wallet mimicking ../wallet.js debit/credit semantics, including
// throwing { code: 'INSUFFICIENT_CHIPS' } on underflow.
function makeWallet(initial) {
  const balances = new Map(Object.entries(initial));
  const escrow = new Map(); // `${tableId}:${seatNo}` -> { userId, stack }
  return {
    balances,
    escrow,
    async debit(userId, amount, _reason, _ref) {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("debit amount must be a positive integer");
      }
      const bal = balances.get(userId) ?? 0;
      if (bal - amount < 0) {
        const e = new Error("insufficient chips");
        e.code = "INSUFFICIENT_CHIPS";
        e.balance = bal;
        e.needed = amount;
        throw e;
      }
      const next = bal - amount;
      balances.set(userId, next);
      return next;
    },
    async credit(userId, amount, _reason, _ref) {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("credit amount must be a positive integer");
      }
      const next = (balances.get(userId) ?? 0) + amount;
      balances.set(userId, next);
      return next;
    },
    // Bank layer — escrow-aware, mirrors bank.js: cash-out is escrow-
    // authoritative + idempotent + owner-checked, so tests exercise the real
    // conservation semantics. Atomicity is emulated (credit before delete).
    async buyIn(userId, amount, tableId, seatNo) {
      const bal = await this.debit(userId, amount);
      escrow.set(`${tableId}:${seatNo}`, { userId, stack: amount });
      return bal;
    },
    async rebuy(userId, amount, tableId, seatNo) {
      const bal = await this.debit(userId, amount);
      const r = escrow.get(`${tableId}:${seatNo}`);
      if (!r || r.userId !== userId) { const e = new Error("escrow missing"); e.code = "ESCROW_MISSING"; throw e; }
      r.stack += amount;
      return { balance: bal, stack: r.stack };
    },
    async cashOut(tableId, seatNo, expectUserId = null) {
      const key = `${tableId}:${seatNo}`;
      const r = escrow.get(key);
      if (!r) return { balance: expectUserId ? (balances.get(expectUserId) ?? 0) : 0, refunded: 0 };
      if (expectUserId && r.userId !== expectUserId) { const e = new Error("owner mismatch"); e.code = "ESCROW_OWNER_MISMATCH"; throw e; }
      const balance = r.stack > 0 ? await this.credit(r.userId, r.stack) : (balances.get(r.userId) ?? 0);
      escrow.delete(key);
      return { balance, refunded: r.stack };
    },
    async syncStacks(tableId, seats) {
      for (const s of seats) { const r = escrow.get(`${tableId}:${s.seatNo}`); if (r && r.userId === s.userId) r.stack = s.stack; }
    },
    total() {
      let sum = 0;
      for (const v of balances.values()) sum += v;
      return sum;
    }
  };
}

// No-op store: hand-number counter + collected persisted hands.
function makeStore() {
  let n = 0;
  const persisted = [];
  return {
    persisted,
    async nextHandNo(_tableId) {
      return ++n;
    },
    async persistHand(hand) {
      persisted.push(hand);
      return "hand-" + persisted.length;
    }
  };
}

// Manual clock. setTimer stores {fn, ms, id}; clearTimer removes it. With
// autoStart:false only ONE timer (the action clock) is ever pending, so the
// test can fire it deterministically.
function makeClock() {
  let seq = 0;
  let t = 1000;
  const timers = new Map();
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, ms, id });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    pendingCount: () => timers.size,
    // Fire the single pending action timer; returns its (possibly async) fn
    // result so the caller can await the full auto-act chain.
    async fire() {
      const entries = [...timers.values()];
      assert.ok(entries.length <= 1, "at most one timer pending at a time");
      if (entries.length === 0) return false;
      const timer = entries[0];
      timers.delete(timer.id);
      await timer.fn();
      return true;
    }
  };
}

// Fake connection: records sent frames, carries a user + a `watching` set.
function makeConn(id, displayName) {
  const frames = [];
  return {
    user: { id, displayName },
    watching: new Set(),
    frames,
    send(data) {
      frames.push(typeof data === "string" ? JSON.parse(data) : data);
    }
  };
}

// ------------------------------------------------------- helpers

function seatStackTotal(table) {
  let sum = 0;
  for (const s of table.seats.values()) sum += s.stack;
  return sum;
}

// Pick a random-but-legal action for the current actor. `mode` biases the
// distribution so we exercise folds/calls/raises/all-ins across the run.
function pickAction(hand, rng, mode) {
  const menu = legalActions(hand);
  const actions = menu.actions;
  assert.ok(actions.length > 0, "actor must have at least one legal action");

  const has = (type) => actions.find((a) => a.type === type);

  if (mode === "allin" && has("allin")) return { type: "allin" };
  if (mode === "aggro") {
    const raise = has("raise") || has("bet");
    if (raise) {
      // Pick a random legal total target between min and max.
      const span = raise.max - raise.min;
      const target = raise.min + Math.floor(rng() * (span + 1));
      return { type: raise.type, amount: target };
    }
  }

  // Default: weighted mix. Fold sometimes, otherwise passive/aggressive.
  const roll = rng();
  if (roll < 0.12 && has("fold")) return { type: "fold" };
  if (roll < 0.2 && has("allin")) return { type: "allin" };
  if (roll < 0.45) {
    const raise = has("raise") || has("bet");
    if (raise) {
      const span = raise.max - raise.min;
      const target = raise.min + Math.floor(rng() * (span + 1));
      return { type: raise.type, amount: target };
    }
  }
  if (has("check")) return { type: "check" };
  if (has("call")) return { type: "call" };
  return { type: "fold" };
}

// ------------------------------------------------------- the simulation

test("LiveTable plays many full hands with conserved chips", async () => {
  const rng = mulberry32(0xc0ffee);
  const clock = makeClock();

  const TABLE_CONFIG = {
    id: "t1",
    name: "Sim Table",
    variant: "holdem",
    max_seats: 6,
    small_blind: 1,
    big_blind: 2,
    min_buyin: 40,
    max_buyin: 200
  };

  // Six players; generous wallets so rebuys are always possible.
  const players = [
    { id: "u0", name: "Alice" },
    { id: "u1", name: "Bob" },
    { id: "u2", name: "Cara" },
    { id: "u3", name: "Dan" },
    { id: "u4", name: "Eve" },
    { id: "u5", name: "Finn" }
  ];
  const START_WALLET = 100_000;
  const walletInit = {};
  for (const p of players) walletInit[p.id] = START_WALLET;
  const wallet = makeWallet(walletInit);
  const store = makeStore();

  const INITIAL_TOTAL = wallet.total(); // all chips are in wallets to start

  const table = new LiveTable(TABLE_CONFIG, null, {
    wallet,
    store,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    rng,
    autoStart: false
  });

  const conns = players.map((p) => makeConn(p.id, p.name));
  for (const c of conns) table.addWatcher(c);

  // Seat everyone with a random buy-in in range.
  for (let i = 0; i < players.length; i++) {
    const buyin =
      TABLE_CONFIG.min_buyin +
      Math.floor(rng() * (TABLE_CONFIG.max_buyin - TABLE_CONFIG.min_buyin + 1));
    await table.sit(conns[i], i, buyin);
  }

  // Total chips (wallet + on-table) must always equal INITIAL_TOTAL.
  const assertConserved = (label) => {
    const total = wallet.total() + seatStackTotal(table);
    assert.equal(
      total,
      INITIAL_TOTAL,
      `chip conservation broken ${label}: ${total} != ${INITIAL_TOTAL}`
    );
    for (const s of table.seats.values()) {
      assert.ok(s.stack >= 0, `seat ${s.seat} negative stack ${s.stack}`);
    }
  };

  assertConserved("after seating");

  const HANDS = 360;
  let handsPlayed = 0;
  let showdownHands = 0;
  let uncontestedHands = 0;
  let allinHands = 0;
  let headsUpHands = 0;
  let autoActFires = 0;

  for (let h = 0; h < HANDS; h++) {
    // Keep the table topped up: rebuy busted players (stack 0) sometimes so
    // we churn through varied stack depths but still exercise busting.
    for (const s of [...table.seats.values()]) {
      if (s.stack === 0) {
        // Rebuy to a random amount, or stand (leaving the seat) occasionally.
        if (rng() < 0.75) {
          const amount =
            TABLE_CONFIG.min_buyin +
            Math.floor(rng() * (TABLE_CONFIG.max_buyin - TABLE_CONFIG.min_buyin + 1));
          await table.rebuy(conns[Number(s.userId.slice(1))], amount);
        } else {
          await table.stand(conns[Number(s.userId.slice(1))]);
        }
      }
    }

    // Re-seat anyone who left, so we usually have a full table but sometimes
    // dip to heads-up.
    for (let i = 0; i < players.length; i++) {
      if (!table.seats.has(i) && rng() < 0.6) {
        const buyin =
          TABLE_CONFIG.min_buyin +
          Math.floor(rng() * (TABLE_CONFIG.max_buyin - TABLE_CONFIG.min_buyin + 1));
        await table.sit(conns[i], i, buyin);
      }
    }

    // Force a heads-up stretch periodically by sitting most players out.
    const headsUp = h % 37 === 0;
    if (headsUp) {
      const active = [...table.seats.keys()].sort((a, b) => a - b);
      for (let k = 2; k < active.length; k++) {
        table.setSitOut(conns[active[k]], true);
      }
    } else {
      for (const s of table.seats.values()) {
        if (s.sittingOut) table.setSitOut(conns[Number(s.userId.slice(1))], false);
      }
    }

    // Need >= 2 eligible seats to deal.
    if (table.eligibleSeats().length < 2) {
      // Re-seat everyone and retry next iteration.
      for (let i = 0; i < players.length; i++) {
        if (!table.seats.has(i)) {
          await table.sit(conns[i], i, TABLE_CONFIG.max_buyin);
        } else if (table.seats.get(i).sittingOut) {
          table.setSitOut(conns[i], false);
        }
      }
      if (table.eligibleSeats().length < 2) continue;
    }

    const eligibleAtStart = table.eligibleSeats().length;
    if (eligibleAtStart === 2) headsUpHands++;

    await table.beginHand();

    // Some hands are "all-in fests", some are timeout-driven.
    const handMode =
      h % 11 === 0 ? "allin" : h % 5 === 0 ? "timeout" : rng() < 0.35 ? "aggro" : "mixed";

    let guard = 0;
    while (table.hand) {
      guard++;
      assert.ok(guard < 5000, "hand did not terminate");

      const toAct = table.hand.toActSeat;
      assert.notEqual(toAct, null, "running hand must have an actor");

      if (handMode === "timeout" && rng() < 0.5) {
        // Exercise autoAct via the action timer.
        autoActFires++;
        const fired = await clock.fire();
        assert.ok(fired, "expected a pending action timer to fire");
      } else {
        const actMode =
          handMode === "allin" ? "allin" : handMode === "aggro" ? "aggro" : "mixed";
        const action = pickAction(table.hand, rng, actMode);
        await table.act(conns[Number(String(toAct))], action);
      }

      // Sanity: pot total mid-hand equals chips contributed out of stacks.
      if (table.hand) {
        const contributed = table.hand.players.reduce(
          (sum, p) => sum + p.totalCommitted,
          0
        );
        assert.equal(
          table.publicView().potTotal,
          contributed,
          "mid-hand potTotal must equal total contributed"
        );
      }
    }

    handsPlayed++;

    // Inspect the just-finished result.
    const view = table.publicView();
    assert.ok(view.result, "finished hand must expose a result");
    if (view.result.type === "showdown") {
      showdownHands++;
      assert.ok(view.result.revealed.length >= 1, "showdown reveals hands");
    } else {
      uncontestedHands++;
      assert.equal(view.result.revealed.length, 0, "uncontested reveals nothing");
    }
    const anyAllin = store.persisted.length
      ? store.persisted[store.persisted.length - 1].seats.some((s) => s.net !== 0)
      : false;
    void anyAllin;

    // Winners' amounts sum to the pot that was contested.
    const wonTotal = view.result.winners.reduce((s, w) => s + w.amount, 0);
    assert.ok(wonTotal >= 0, "winners cannot win negative chips");

    // Detect all-in hands (some player was driven to a 0 stack this hand).
    const persistedHand = store.persisted[store.persisted.length - 1];
    if (persistedHand) {
      const busted = [...table.seats.values()].some((s) => s.stack === 0);
      if (busted) allinHands++;
    }

    assertConserved(`after hand ${h}`);

    // potTotal reconciliation: winners paid out exactly equals the pot for
    // this hand (engine conserves chips within the hand).
    assert.equal(
      wonTotal,
      view.potTotal,
      `hand ${h}: winners (${wonTotal}) must equal potTotal (${view.potTotal})`
    );

    if (headsUp) headsUpHands++;
  }

  // ------------------------------------------------------- final assertions
  assert.ok(handsPlayed >= 300, `played only ${handsPlayed} hands`);
  assert.ok(showdownHands > 0, "expected some showdown hands");
  assert.ok(uncontestedHands > 0, "expected some uncontested hands");
  assert.ok(allinHands > 0, "expected some all-in / bust hands");
  assert.ok(headsUpHands > 0, "expected some heads-up hands");
  assert.ok(autoActFires > 0, "expected the auto-act path to run");
  assert.equal(store.persisted.length, handsPlayed, "every hand persisted");
  assertConserved("at end");
});

// A focused heads-up all-in test: two players, repeated shove-fests, always
// conserves chips and settles side-pot-free showdowns.
test("LiveTable heads-up all-in settles correctly", async () => {
  const rng = mulberry32(42);
  const clock = makeClock();
  const wallet = makeWallet({ a: 10_000, b: 10_000 });
  const store = makeStore();
  const INITIAL_TOTAL = wallet.total();

  const table = new LiveTable(
    {
      id: "hu",
      name: "HU",
      max_seats: 2,
      small_blind: 5,
      big_blind: 10,
      min_buyin: 100,
      max_buyin: 400
    },
    null,
    {
      wallet,
      store,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      rng,
      autoStart: false
    }
  );

  const ca = makeConn("a", "A");
  const cb = makeConn("b", "B");
  table.addWatcher(ca);
  table.addWatcher(cb);
  await table.sit(ca, 0, 200);
  await table.sit(cb, 1, 200);

  let played = 0;
  for (let h = 0; h < 120; h++) {
    // Rebuy busted players to keep the duel going.
    for (const [seatNo, s] of table.seats) {
      if (s.stack === 0) {
        await table.rebuy(seatNo === 0 ? ca : cb, 200);
      }
    }
    if (table.eligibleSeats().length < 2) break;

    await table.beginHand();
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 200, "heads-up hand stuck");
      const toAct = table.hand.toActSeat;
      const menu = legalActions(table.hand);
      // Shove or call all-ins to force showdowns.
      const allin = menu.actions.find((a) => a.type === "allin");
      const call = menu.actions.find((a) => a.type === "call");
      const check = menu.actions.find((a) => a.type === "check");
      let action;
      if (allin && rng() < 0.7) action = { type: "allin" };
      else if (call) action = { type: "call" };
      else if (check) action = { type: "check" };
      else action = { type: "allin" };
      await table.act(toAct === 0 ? ca : cb, action);
    }
    played++;

    const total = wallet.total() + [...table.seats.values()].reduce((s, x) => s + x.stack, 0);
    assert.equal(total, INITIAL_TOTAL, `HU chip conservation broken at hand ${h}`);
    for (const s of table.seats.values()) {
      assert.ok(s.stack >= 0, "no negative stacks");
    }
    const view = table.publicView();
    const won = view.result.winners.reduce((s, w) => s + w.amount, 0);
    assert.equal(won, view.potTotal, `HU hand ${h}: winners must equal potTotal`);
  }

  assert.ok(played > 50, `played only ${played} heads-up hands`);
});
