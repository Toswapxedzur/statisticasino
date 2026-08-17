// Adversarial test suite for LiveTable (the real-time table orchestrator).
//
// Everything time/DB/random is injected via fakes so each scenario is fully
// deterministic: a manual clock whose single pending timer we fire by hand, an
// in-memory wallet with the real debit/credit semantics (including
// INSUFFICIENT_CHIPS), a no-op store, and — crucially — an rng that FORCES the
// deck shuffle to a chosen order so we can rig hole cards and the board to
// produce ties, side pots, and busts on demand.
//
// Each test drives a hostile sequence of sits/actions/timeouts/disconnects and
// asserts a hard correctness property (chip conservation, pot eligibility,
// no-reveal on fold, exactly-once cashout, ...). Every action we submit is
// engine-LEGAL (pulled from legalActions on table.hand).

import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveTable, DISCONNECT_GRACE_MS } from "./table.js";
import { legalActions, standardDeck } from "./engine/index.js";

// --------------------------------------------------------------- fakes

// In-memory wallet mirroring ../wallet.js: positive-integer debit/credit,
// throws { code:'INSUFFICIENT_CHIPS' } on underflow. Counts credits per user so
// tests can assert cash-out happens exactly once.
function makeWallet(initial) {
  const balances = new Map(Object.entries(initial));
  const creditCalls = new Map();
  const escrow = new Map(); // `${tableId}:${seatNo}` -> { userId, stack }
  return {
    balances,
    creditCalls,
    escrow,
    async debit(userId, amount, _reason, _ref) {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("debit amount must be a positive integer");
      }
      const bal = balances.get(userId) ?? 0;
      if (bal - amount < 0) {
        const e = new Error("insufficient chips");
        e.code = "INSUFFICIENT_CHIPS";
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
      creditCalls.set(userId, (creditCalls.get(userId) ?? 0) + 1);
      const next = (balances.get(userId) ?? 0) + amount;
      balances.set(userId, next);
      return next;
    },
    // Bank layer — escrow-aware, mirrors bank.js (escrow-authoritative +
    // idempotent + owner-checked cash-out). cashOut still routes through credit
    // so creditCalls keeps counting exactly-once cash-outs.
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
      return bal;
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

function makeStore() {
  let n = 0;
  const persisted = [];
  return {
    persisted,
    async nextHandNo() {
      return ++n;
    },
    async persistHand(hand) {
      persisted.push(hand);
      return "hand-" + persisted.length;
    }
  };
}

// Manual clock. With autoStart:false the only timer ever pending is the action
// clock, so `fire()` deterministically triggers autoAct.
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

// Fake connection: records frames, carries a user + a `watching` set.
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

// --------------------------------------------------------------- deck rigging

// Build a full 52-card deck array with specific cards pinned at specific deck
// indices; the rest are filled from the canonical order.
function riggedDeck(fixed) {
  const deck = new Array(52).fill(null);
  const used = new Set();
  for (const [idx, card] of Object.entries(fixed)) {
    deck[Number(idx)] = card;
    used.add(card);
  }
  const rest = standardDeck().filter((c) => !used.has(c));
  let r = 0;
  for (let i = 0; i < 52; i++) if (deck[i] === null) deck[i] = rest[r++];
  assert.equal(new Set(deck).size, 52, "rigged deck must be 52 unique cards");
  return deck;
}

// An rng such that shuffle(standardDeck(), rng) === target. Fisher-Yates runs
// i = 51..1 choosing j = floor(rng()*(i+1)); we pick j to place target[i], so
// value = j/(i+1) reproduces it exactly. Consumes exactly 51 calls per hand.
function deckRng(target) {
  const work = standardDeck();
  const values = [];
  for (let i = 51; i > 0; i--) {
    let j = -1;
    for (let k = 0; k <= i; k++) {
      if (work[k] === target[i]) {
        j = k;
        break;
      }
    }
    assert.notEqual(j, -1, "target card must exist in deck");
    values.push(j / (i + 1));
    [work[i], work[j]] = [work[j], work[i]];
  }
  let idx = 0;
  return () => values[idx++];
}

// mulberry32 — seeded PRNG for the long random run.
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

// --------------------------------------------------------------- helpers

const BASE_CONFIG = {
  id: "t",
  name: "Adv",
  variant: "holdem",
  max_seats: 6,
  small_blind: 5,
  big_blind: 10,
  min_buyin: 2,
  max_buyin: 100000
};

function seatStackTotal(table) {
  let sum = 0;
  for (const s of table.seats.values()) sum += s.stack;
  return sum;
}

// Build a table + conns for `n` users seated in seats 0..n-1 with given buyins.
async function setupTable({ rng, clock, wallet, store, buyins, walletStart = 1_000_000, config }) {
  const cfg = { ...BASE_CONFIG, ...(config || {}) };
  const n = buyins.length;
  const walletInit = {};
  for (let i = 0; i < n; i++) walletInit["u" + i] = walletStart;
  wallet = wallet || makeWallet(walletInit);
  store = store || makeStore();

  const table = new LiveTable(cfg, null, {
    wallet,
    store,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    rng,
    autoStart: false
  });

  const conns = [];
  for (let i = 0; i < n; i++) {
    const c = makeConn("u" + i, "P" + i);
    conns.push(c);
    table.addWatcher(c);
  }
  for (let i = 0; i < n; i++) await table.sit(conns[i], i, buyins[i]);

  return { table, conns, wallet, store, cfg };
}

// Passive line: check if legal, else call, else fold. Guarantees termination.
function passiveAction(hand) {
  const menu = legalActions(hand);
  if (menu.actions.find((a) => a.type === "check")) return { type: "check" };
  if (menu.actions.find((a) => a.type === "call")) return { type: "call" };
  return { type: "fold" };
}

// --------------------------------------------------------------- scenario 1

test("scenario 1: three all-in with distinct stacks -> main + 2 side pots, conserved, correct eligibility", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  // Deepest stack must act FIRST so it can shove into live opponents; a deep
  // stack acting last can only CALL (the engine correctly refuses an all-in
  // raise when nobody else is still active). 3-handed the button (seat0) acts
  // first preflop, so seat0 = deepest.
  const { table, conns } = await setupTable({
    rng: mulberry32(1),
    clock,
    wallet,
    store,
    buyins: [100, 60, 30]
  });

  await table.beginHand();
  // seat0 shoves 100; seat1 all-in-calls to 60; seat2 all-in-calls to 30.
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 100, "hand stuck");
    const toAct = table.hand.toActSeat;
    const menu = legalActions(table.hand);
    const allin = menu.actions.find((a) => a.type === "allin");
    assert.ok(allin, `seat ${toAct} must be able to go all-in`);
    await table.act(conns[toAct], { type: "allin" });
  }

  // Three distinct commitment levels (30/60/100) -> three pot layers.
  const pots = table.resultPots;
  assert.equal(pots.length, 3, "expected main + 2 side pots");
  // Layer amounts: 30*3=90, 30*2=60, 40*1=40.
  assert.deepEqual(
    pots.map((p) => p.amount),
    [90, 60, 40],
    "pot layer amounts"
  );
  // Eligibility narrows as commitment increases (deepest is seat0).
  assert.deepEqual(pots[0].eligibleSeats, [0, 1, 2], "main pot: all three eligible");
  assert.deepEqual(pots[1].eligibleSeats, [0, 1], "side pot 1: only the two deeper stacks");
  assert.deepEqual(pots[2].eligibleSeats, [0], "side pot 2 (1-player layer): deepest only");

  // Chip conservation.
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
  for (const s of table.seats.values()) assert.ok(s.stack >= 0, "no negative stack");
  // Total on-table stacks after the hand equal the total committed (190).
  assert.equal(seatStackTotal(table), 190, "all chips redistributed among the three seats");
});

// --------------------------------------------------------------- scenario 2

test("scenario 2: tie split pot with an odd chip goes clockwise from the button", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  // 3 players -> 6 hole cards, board at deck indices 6..10. Put a spade royal
  // flush on the board so every non-folded player plays the board -> chop.
  const target = riggedDeck({ 6: "Ts", 7: "Js", 8: "Qs", 9: "Ks", 10: "As" });

  const { table, conns } = await setupTable({
    rng: deckRng(target),
    clock,
    wallet,
    store,
    buyins: [100, 100, 100]
  });

  await table.beginHand();
  assert.equal(table.buttonSeat, 0, "first hand button is lowest eligible seat");

  // Preflop: seat0 (button) calls, seat1 (SB) folds, seat2 (BB) checks.
  await table.act(conns[0], { type: "call" });
  await table.act(conns[1], { type: "fold" });
  await table.act(conns[2], { type: "check" });
  // Check the hand down to showdown.
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 100, "hand stuck");
    const toAct = table.hand.toActSeat;
    await table.act(conns[toAct], passiveAction(table.hand));
  }

  const result = table.result;
  assert.equal(result.type, "showdown", "reaches showdown");

  // Pot = 10 (seat0) + 5 (seat1 folded SB) + 10 (seat2) = 25, split between
  // seat0 & seat2 -> 12 vs 13, the odd chip to the first winner clockwise from
  // the button (seat2 sits before seat0 in that order).
  const winners = new Map(result.winners.map((w) => [w.seat, w.amount]));
  assert.deepEqual([...winners.keys()].sort(), [0, 2], "the two non-folded players split");
  assert.equal(winners.get(0) + winners.get(2), 25, "winners share the whole 25-chip pot");
  assert.equal(winners.get(2) - winners.get(0), 1, "odd chip awarded to seat2 (clockwise from button)");

  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

// --------------------------------------------------------------- scenario 3

test("scenario 3: everyone folds to a preflop raise -> raiser wins, uncalled bet returned, no reveal", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  const { table, conns } = await setupTable({
    rng: mulberry32(7),
    clock,
    wallet,
    store,
    buyins: [100, 100, 100]
  });

  await table.beginHand();
  const startStacks = new Map([...table.seats].map(([n, s]) => [n, s.stackAtHandStart]));

  // seat0 raises to 30; seat1 and seat2 fold.
  const menu = legalActions(table.hand);
  const raise = menu.actions.find((a) => a.type === "raise");
  assert.ok(raise, "raise must be legal for the opener");
  await table.act(conns[0], { type: "raise", amount: 30 });
  await table.act(conns[1], { type: "fold" });
  await table.act(conns[2], { type: "fold" });

  assert.equal(table.hand, null, "hand ends immediately once all fold");
  const result = table.result;
  assert.equal(result.type, "uncontested", "uncontested win");
  assert.deepEqual(result.revealed, [], "no cards revealed on a fold-out");
  assert.deepEqual(result.board, [], "no community cards dealt");
  assert.equal(result.winners.length, 1, "single winner");
  assert.equal(result.winners[0].seat, 0, "the raiser wins");

  // Pot the raiser actually wins = 5 (SB) + 10 (BB) + his matched 10 = 25; his
  // 20 uncalled overbet is returned. Net +15 for seat0 = 5 + 10 lost by others.
  assert.equal(result.winners[0].amount, 25, "won pot excludes the returned uncalled bet");
  const s0 = table.seats.get(0);
  assert.equal(s0.stack - startStacks.get(0), 15, "raiser net = blinds collected");

  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

// --------------------------------------------------------------- scenario 4

test("scenario 4: heads-up button posts SB and acts first preflop; BB acts first postflop", async () => {
  const clock = makeClock();
  const { table, conns } = await setupTable({
    rng: mulberry32(11),
    clock,
    buyins: [200, 200],
    config: { max_seats: 2 }
  });

  await table.beginHand();
  assert.equal(table.buttonSeat, 0, "button is seat0");
  assert.equal(table.sbSeat, 0, "heads-up: button posts the small blind");
  assert.equal(table.bbSeat, 1, "the other seat posts the big blind");
  assert.equal(table.hand.toActSeat, 0, "heads-up button (SB) acts first preflop");

  const sb = table.seats.get(0);
  const bb = table.seats.get(1);
  assert.equal(sb.committedThisStreet, 5, "SB posted 5");
  assert.equal(bb.committedThisStreet, 10, "BB posted 10");

  // Complete the blind and check -> flop.
  await table.act(conns[0], { type: "call" });
  await table.act(conns[1], { type: "check" });
  assert.equal(table.hand.street, "flop", "advanced to flop");
  assert.equal(table.hand.toActSeat, 1, "postflop the BB (non-button) acts first heads-up");
});

// --------------------------------------------------------------- scenario 5

test("scenario 5: seated player disconnects on their turn -> grace clock fires -> autoAct completes the hand", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  const { table, conns } = await setupTable({
    rng: mulberry32(3),
    clock,
    wallet,
    store,
    buyins: [200, 200],
    config: { max_seats: 2 }
  });

  await table.beginHand();
  assert.equal(table.hand.toActSeat, 0, "seat0 (button/SB) is to act");

  // Disconnect seat0 exactly as the hub would: detach the watcher, then notify.
  table.removeWatcher(conns[0]);
  assert.equal(table.isConnected(table.seats.get(0)), false, "seat0 now shows disconnected");
  table.onConnectionGone(conns[0]);

  // Grace clock should be armed and shortened.
  assert.equal(clock.pendingCount(), 1, "exactly one (grace) timer pending");
  assert.equal(
    table.actionDeadline,
    clock.now() + DISCONNECT_GRACE_MS,
    "deadline shortened to the disconnect grace window"
  );

  // Firing it auto-acts (SB facing BB cannot check -> folds), ending the hand.
  await clock.fire();
  assert.equal(table.hand, null, "hand completed after the disconnected actor auto-acted");
  assert.equal(table.result.type, "uncontested", "the connected player wins uncontested");
  assert.equal(table.result.winners[0].seat, 1, "seat1 wins");

  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

// --------------------------------------------------------------- scenario 6

test("scenario 6: player disconnects when it is NOT their turn -> the hand does not stall", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  const { table, conns } = await setupTable({
    rng: mulberry32(5),
    clock,
    wallet,
    store,
    buyins: [200, 200, 200]
  });

  await table.beginHand();
  assert.equal(table.hand.toActSeat, 0, "seat0 to act first");

  // Disconnect seat2 while it is seat0's turn (not seat2's).
  table.removeWatcher(conns[2]);
  table.onConnectionGone(conns[2]);
  assert.ok(table.hand, "hand still running after an off-turn disconnect");

  // Drive to completion: when the disconnected seat is to act, fire the grace
  // clock (autoAct); otherwise play a passive legal line.
  let guard = 0;
  let autoActs = 0;
  while (table.hand) {
    assert.ok(guard++ < 200, "hand stalled / did not terminate");
    const toAct = table.hand.toActSeat;
    if (toAct === 2) {
      assert.equal(clock.pendingCount(), 1, "grace timer armed for the disconnected actor");
      const fired = await clock.fire();
      assert.ok(fired, "the disconnected seat's clock fired");
      autoActs++;
    } else {
      await table.act(conns[toAct], passiveAction(table.hand));
    }
  }

  assert.ok(autoActs >= 1, "the disconnected seat was auto-acted at least once");
  assert.ok(table.result, "hand produced a result");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

// --------------------------------------------------------------- scenario 7

test("scenario 7: a player who sits mid-hand is not dealt in, but is dealt the next hand", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();

  const { table, conns } = await setupTable({
    rng: mulberry32(9),
    clock,
    wallet,
    store,
    buyins: [200, 200],
    config: { max_seats: 6 }
  });

  await table.beginHand();
  assert.ok(table.hand, "a hand is running");

  // A third player joins and sits DURING the hand.
  const c2 = makeConn("u2", "P2");
  table.addWatcher(c2);
  await table.sit(c2, 2, 200);

  // Not dealt into the running hand.
  assert.equal(table.enginePlayer(2), null, "newcomer has no engine player this hand");
  const view = table.publicView();
  const seat2View = view.seats.find((s) => s.seat === 2);
  assert.equal(seat2View.inHand, false, "newcomer is not in the hand");
  assert.equal(seat2View.hasCards, false, "newcomer holds no cards this hand");
  assert.equal(table.seats.get(2).holeCards, null, "no hole cards copied to the newcomer");

  // Play the current hand out.
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 200, "hand stuck");
    await table.act(conns[table.hand.toActSeat] || c2, passiveAction(table.hand));
  }

  // Next hand: the newcomer is now eligible and dealt in.
  await table.beginHand();
  assert.ok(table.hand, "next hand started");
  assert.notEqual(table.enginePlayer(2), null, "newcomer is dealt into the next hand");
  assert.equal(table.seats.get(2).inHand, true, "newcomer is in the next hand");
  assert.equal(table.seats.get(2).holeCards.length, 2, "newcomer got two hole cards");
});

// --------------------------------------------------------------- scenario 8

test("scenario 8: standing mid-hand cashes out exactly once at hand end; chips conserved", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 1000, u1: 1000, u2: 1000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  const { table, conns } = await setupTable({
    rng: mulberry32(13),
    clock,
    wallet,
    store,
    buyins: [200, 200, 200]
  });

  await table.beginHand();

  // seat1 asks to leave mid-hand.
  await table.stand(conns[1]);
  assert.equal(table.seats.get(1).wantsToLeave, true, "flagged to leave");
  assert.ok(table.seats.has(1), "seat still present during the hand");
  assert.equal(wallet.balances.get("u1"), 1000 - 200, "not yet credited mid-hand");
  assert.equal(wallet.creditCalls.get("u1") ?? 0, 0, "no credit yet");

  // Play the hand out.
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 300, "hand stuck");
    const toAct = table.hand.toActSeat;
    await table.act(conns[toAct], passiveAction(table.hand));
  }

  // Cashed out exactly once, seat removed.
  assert.equal(table.seats.has(1), false, "seat freed at hand end");
  assert.equal(wallet.creditCalls.get("u1"), 1, "cashed out exactly once");
  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved through cash-out");
});

// --------------------------------------------------------------- scenario 9

test("scenario 9: bust then rebuy -> eligible again, wallet math correct", async () => {
  const clock = makeClock();
  const wallet = makeWallet({ u0: 5000, u1: 5000 });
  const store = makeStore();
  const INITIAL = wallet.total();

  // Rig seat1 to win: dealOrder heads-up is [seat1, seat0], so deck[0],deck[2]
  // are seat1's cards and deck[1],deck[3] are seat0's; board at deck[4..8].
  const target = riggedDeck({
    0: "As",
    2: "Ac", // seat1: pair of aces
    1: "2d",
    3: "7h", // seat0: junk
    4: "Kd",
    5: "Qs",
    6: "9c",
    7: "4h",
    8: "3s"
  });

  const { table, conns } = await setupTable({
    rng: deckRng(target),
    clock,
    wallet,
    store,
    buyins: [200, 200],
    config: { max_seats: 2 }
  });

  await table.beginHand();
  // Both shove; seat0 busts.
  let guard = 0;
  while (table.hand) {
    assert.ok(guard++ < 50, "hand stuck");
    const toAct = table.hand.toActSeat;
    const menu = legalActions(table.hand);
    const allin = menu.actions.find((a) => a.type === "allin");
    const call = menu.actions.find((a) => a.type === "call");
    await table.act(conns[toAct], allin ? { type: "allin" } : call ? { type: "call" } : { type: "check" });
  }

  assert.equal(table.seats.get(0).stack, 0, "seat0 busted");
  assert.equal(table.seats.get(1).stack, 400, "seat1 scooped the pot");

  // Busted seat is still seated but NOT eligible.
  assert.ok(table.seats.has(0), "busted player keeps their seat");
  assert.equal(
    table.eligibleSeats().some((s) => s.seat === 0),
    false,
    "a 0-stack seat is ineligible"
  );

  // Wallet before rebuy: started 5000, bought in 200 -> 4800 (the 200 was lost
  // on the table to seat1).
  assert.equal(wallet.balances.get("u0"), 4800, "wallet reflects the lost buy-in");

  // Rebuy between hands.
  await table.rebuy(conns[0], 200);
  assert.equal(table.seats.get(0).stack, 200, "stack topped back up");
  assert.equal(wallet.balances.get("u0"), 4600, "rebuy debited from wallet");
  assert.equal(
    table.eligibleSeats().some((s) => s.seat === 0),
    true,
    "rebought player is eligible again"
  );

  assert.equal(wallet.total() + seatStackTotal(table), INITIAL, "chips conserved");
});

// --------------------------------------------------------------- scenario 10

// Weighted random-but-legal action picker.
function pickAction(hand, rng) {
  const actions = legalActions(hand).actions;
  const has = (t) => actions.find((a) => a.type === t);
  const roll = rng();
  if (roll < 0.1 && has("fold")) return { type: "fold" };
  if (roll < 0.2 && has("allin")) return { type: "allin" };
  if (roll < 0.45) {
    const agg = has("raise") || has("bet");
    if (agg) {
      const span = agg.max - agg.min;
      return { type: agg.type, amount: agg.min + Math.floor(rng() * (span + 1)) };
    }
  }
  if (has("check")) return { type: "check" };
  if (has("call")) return { type: "call" };
  return { type: "fold" };
}

test("scenario 10: 500+ hands of random legal play with churn -> global chip conservation, no exceptions", async () => {
  const rng = mulberry32(0xbadbeef);
  const clock = makeClock();
  const MAX = 6;
  const START_WALLET = 200_000;
  const walletInit = {};
  for (let i = 0; i < MAX; i++) walletInit["u" + i] = START_WALLET;
  const wallet = makeWallet(walletInit);
  const store = makeStore();
  const INITIAL = wallet.total();

  const table = new LiveTable(
    { ...BASE_CONFIG, id: "sim", max_seats: MAX, min_buyin: 40, max_buyin: 400 },
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

  const conns = [];
  for (let i = 0; i < MAX; i++) {
    const c = makeConn("u" + i, "P" + i);
    conns.push(c);
    table.addWatcher(c);
  }

  const randBuyin = () => 40 + Math.floor(rng() * (400 - 40 + 1));

  // Seat everyone to start.
  for (let i = 0; i < MAX; i++) await table.sit(conns[i], i, randBuyin());

  const assertConserved = (label) => {
    const total = wallet.total() + seatStackTotal(table);
    assert.equal(total, INITIAL, `chip conservation broken ${label}`);
    for (const s of table.seats.values()) assert.ok(s.stack >= 0, `negative stack ${label}`);
  };
  assertConserved("after seating");

  const HANDS = 520;
  let played = 0;
  let timeoutFires = 0;

  for (let h = 0; h < HANDS; h++) {
    // Churn: rebuy or stand busted players.
    for (const s of [...table.seats.values()]) {
      if (s.stack === 0) {
        const conn = conns[Number(s.userId.slice(1))];
        if (rng() < 0.7) await table.rebuy(conn, randBuyin());
        else await table.stand(conn);
      }
    }
    // Re-seat some empty seats.
    for (let i = 0; i < MAX; i++) {
      if (!table.seats.has(i) && rng() < 0.6) await table.sit(conns[i], i, randBuyin());
    }
    // Random sit-out toggling (but never starve below 2 eligible).
    for (const s of table.seats.values()) {
      const conn = conns[Number(s.userId.slice(1))];
      if (rng() < 0.15) table.setSitOut(conn, true);
      else if (s.sittingOut && rng() < 0.7) table.setSitOut(conn, false);
    }

    // Ensure >= 2 eligible; if not, un-sit-out / re-seat.
    if (table.eligibleSeats().length < 2) {
      for (let i = 0; i < MAX; i++) {
        if (!table.seats.has(i)) await table.sit(conns[i], i, randBuyin());
        else if (table.seats.get(i).sittingOut) table.setSitOut(conns[i], false);
      }
      if (table.eligibleSeats().length < 2) continue;
    }

    await table.beginHand();

    const timeoutHand = h % 6 === 0;
    let guard = 0;
    while (table.hand) {
      assert.ok(guard++ < 5000, "hand did not terminate");
      const toAct = table.hand.toActSeat;
      assert.notEqual(toAct, null, "running hand must have an actor");

      if (timeoutHand && rng() < 0.4) {
        timeoutFires++;
        const fired = await clock.fire();
        assert.ok(fired, "expected a pending action timer");
      } else {
        await table.act(conns[toAct], pickAction(table.hand, rng));
      }

      // Mid-hand potTotal must equal total contributed out of stacks.
      if (table.hand) {
        const contributed = table.hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);
        assert.equal(table.publicView().potTotal, contributed, "mid-hand potTotal reconciles");
      }
    }

    played++;
    const view = table.publicView();
    assert.ok(view.result, "finished hand exposes a result");
    const won = view.result.winners.reduce((s, w) => s + w.amount, 0);
    assert.equal(won, view.potTotal, `hand ${h}: winners must equal potTotal`);
    assertConserved(`after hand ${h}`);
  }

  assert.ok(played >= 500, `played only ${played} hands (need >= 500)`);
  assert.ok(timeoutFires > 0, "exercised the autoAct/timeout path");
  assert.equal(store.persisted.length, played, "every hand persisted exactly once");
  assertConserved("at end");
});
