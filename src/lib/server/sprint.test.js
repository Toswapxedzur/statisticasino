// River Sprint lifecycle — registration (bid + one-per-day) and payout
// distribution, against an in-memory db mock that honors the UNIQUE constraints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { register, finishRound } from "./sprint.js";
import { prizePool, payoutTable } from "./sprint-core.js";
import { REASON } from "./wallet.js";

function makeDb(rounds) {
  const map = new Map(rounds.map((r) => [r.id, { entrants: 0, faucet_bps: 3000, ...r }]));
  const entries = []; // { round_id, user_id, day_key, bid_paid, final_stack, place, prize }
  return {
    map, entries,
    async query(sql, p) {
      if (sql.includes("FROM sprint_round WHERE id")) { const r = map.get(p[0]); return r ? [r] : []; }
      if (sql.includes("SELECT round_id FROM sprint_entry WHERE user_id")) {
        const [uid, dk] = p;
        return entries.filter((e) => e.user_id === uid && e.day_key === dk).map((e) => ({ round_id: e.round_id }));
      }
      if (sql.includes("SUM(bid_paid)")) {
        const [rid] = p;
        return [{ bids: entries.filter((e) => e.round_id === rid).reduce((a, e) => a + e.bid_paid, 0) }];
      }
      return [];
    },
    async execute(sql, p) {
      if (sql.includes("INSERT INTO sprint_entry")) {
        const [round_id, user_id, day_key, bid_paid] = p;
        if (entries.some((e) => e.user_id === user_id && e.day_key === day_key)) {
          const err = new Error("dup"); err.code = "ER_DUP_ENTRY"; throw err;
        }
        entries.push({ round_id, user_id, day_key, bid_paid, final_stack: null, place: null, prize: 0 });
        return { affectedRows: 1 };
      }
      if (sql.includes("DELETE FROM sprint_entry")) {
        const [rid, uid] = p; const i = entries.findIndex((e) => e.round_id === rid && e.user_id === uid);
        if (i >= 0) { entries.splice(i, 1); return { affectedRows: 1 }; } return { affectedRows: 0 };
      }
      if (sql.includes("UPDATE sprint_entry SET final_stack")) {
        const [fs, place, prize, rid, uid] = p; const e = entries.find((x) => x.round_id === rid && x.user_id === uid);
        if (e) { e.final_stack = fs; e.place = place; e.prize = prize; } return { affectedRows: e ? 1 : 0 };
      }
      if (sql.includes("UPDATE sprint_round SET entrants")) { const r = map.get(p[0]); if (r) r.entrants++; return { affectedRows: 1 }; }
      if (sql.includes("UPDATE sprint_round SET status")) { const r = map.get(p[p.length - 1]); if (r) { r.status = "done"; r.prize_pool = p[0]; } return { affectedRows: 1 }; }
      return { affectedRows: 1 }; // quest_progress / user_achievement inserts
    },
  };
}

function makeWallet(broke = new Set()) {
  const debits = [], credits = [];
  return {
    debits, credits,
    async debit(u, a, r) { if (broke.has(u)) { const e = new Error("nc"); e.code = "INSUFFICIENT_CHIPS"; throw e; } debits.push({ u, a, r }); return 1; },
    async credit(u, a, r, ref) { credits.push({ u, a, r, ref }); return 1; },
  };
}

const AT = Date.UTC(2026, 7, 27, 10);

test("register debits the bid and records an entry", async () => {
  const db = makeDb([{ id: "R1", status: "scheduled", bid: 200 }]);
  const w = makeWallet();
  const res = await register("R1", "h1", db, w, AT);
  assert.equal(res.ok, true);
  assert.equal(w.debits.length, 1);
  assert.equal(w.debits[0].a, 200);
  assert.equal(db.entries.length, 1);
  assert.equal(db.map.get("R1").entrants, 1);
});

test("one entry per day — a second round the same day is rejected", async () => {
  const db = makeDb([{ id: "A", status: "scheduled", bid: 200 }, { id: "B", status: "scheduled", bid: 200 }]);
  const w = makeWallet();
  assert.equal((await register("A", "h1", db, w, AT)).ok, true);
  const second = await register("B", "h1", db, w, AT);
  assert.equal(second.ok, false);
  assert.equal(second.error, "already_today");
  assert.equal(w.debits.length, 1, "no second bid charged");
});

test("re-registering the same round is flagged distinctly", async () => {
  const db = makeDb([{ id: "A", status: "scheduled", bid: 200 }]);
  const w = makeWallet();
  await register("A", "h1", db, w, AT);
  const again = await register("A", "h1", db, w, AT);
  assert.equal(again.error, "already_registered");
});

test("an underfunded bid rolls the daily slot back", async () => {
  const db = makeDb([{ id: "A", status: "scheduled", bid: 200 }]);
  const w = makeWallet(new Set(["broke"]));
  const res = await register("A", "broke", db, w, AT);
  assert.equal(res.ok, false);
  assert.equal(res.error, "insufficient");
  assert.equal(db.entries.length, 0, "slot released so they can retry");
});

test("finishRound pays the top-heavy ladder and forfeits bot places", async () => {
  const db = makeDb([{ id: "R", status: "live", bid: 100, faucet_bps: 3000 }]);
  const w = makeWallet();
  // Seed 4 human entries (bid 100 each) directly.
  for (const u of ["h1", "h2", "h3", "h4"]) db.entries.push({ round_id: "R", user_id: u, day_key: "2026-08-27", bid_paid: 100, final_stack: null, place: null, prize: 0 });

  // Field = 4 humans + 1 bot (5). A BOT finishes 1st and forfeits; h1 is the top human.
  const standings = [
    { id: "bot9", stack: 9000, isHuman: false },
    { id: "h1", stack: 6000, isHuman: true },
    { id: "h2", stack: 3000, isHuman: true },
    { id: "h3", stack: 0, bustAt: 50, isHuman: true },
    { id: "h4", stack: 0, bustAt: 10, isHuman: true },
  ];
  const out = await finishRound("R", standings, db, w, AT);
  assert.equal(out.ok, true);

  const totalBids = 400;
  const expectedPool = prizePool(totalBids, 3000); // 400 / 0.7 → 571
  assert.equal(out.pool, expectedPool);
  assert.equal(out.field, 5);
  const paid = payoutTable(expectedPool, 5, 0.15); // ceil(0.75)=1 place
  assert.equal(out.paidPlaces, paid.length);

  // The bot placed 1st (forfeits); the only paid place goes to nobody OR to the
  // human at that place. Here paidPlaces=1 and place 1 is the bot → no prize paid.
  const prizeCredits = w.credits.filter((c) => c.r === REASON.SPRINT_PRIZE);
  assert.equal(prizeCredits.length, 0, "bot at the sole paid place forfeits");

  // Human places are still recorded (bot occupies place 1, so h1 is place 2).
  const h1 = db.entries.find((e) => e.user_id === "h1");
  assert.equal(h1.place, 2);
  assert.equal(db.map.get("R").status, "done");
});

test("finishRound pays a human champion when they top the field", async () => {
  const db = makeDb([{ id: "R2", status: "live", bid: 100, faucet_bps: 3000 }]);
  const w = makeWallet();
  for (const u of ["a", "b", "c", "d"]) db.entries.push({ round_id: "R2", user_id: u, day_key: "2026-08-27", bid_paid: 100, final_stack: null, place: null, prize: 0 });
  const standings = [
    { id: "a", stack: 9000, isHuman: true },
    { id: "b", stack: 3000, isHuman: true },
    { id: "c", stack: 0, bustAt: 50, isHuman: true },
    { id: "d", stack: 0, bustAt: 10, isHuman: true },
  ];
  const out = await finishRound("R2", standings, db, w, AT);
  const prizeCredits = w.credits.filter((c) => c.r === REASON.SPRINT_PRIZE);
  assert.equal(prizeCredits.length, 1);
  assert.equal(prizeCredits[0].u, "a");
  assert.equal(prizeCredits[0].a, out.pool); // single paid place gets the whole pool
  // Champion also earns the event badges (achievement_reward credits present).
  assert.ok(w.credits.some((c) => c.r === REASON.ACHIEVEMENT_REWARD));
});
