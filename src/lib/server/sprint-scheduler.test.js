// River Sprint scheduler — timing helpers + the create/open/run tick, against an
// in-memory sprint store. The pool engine is a stub runner returning standings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayRoundTimes, ensureRounds, runDue, tick, ROUND_HOURS_UTC } from "./sprint-scheduler.js";

// Compact in-memory store covering the statements sprint.js runs on this path.
function makeStore() {
  const rounds = new Map();
  const entries = [];
  const wallet = { credits: [], async credit(u, a, r) { this.credits.push({ u, a, r }); return 1; }, async debit() { return 1; } };
  const db = {
    rounds, entries,
    async query(sql, p) {
      if (sql.includes("WHERE scheduled_at = ?")) { for (const r of rounds.values()) if (r.scheduled_at === p[0]) return [{ id: r.id }]; return []; }
      if (sql.includes("status IN ('scheduled','registering','live')")) {
        return [...rounds.values()].filter((r) => ["scheduled", "registering", "live"].includes(r.status)).sort((a, b) => a.scheduled_at - b.scheduled_at).slice(0, p[0]);
      }
      if (sql.includes("status IN ('scheduled','registering') AND scheduled_at <= ?")) {
        return [...rounds.values()].filter((r) => ["scheduled", "registering"].includes(r.status) && r.scheduled_at <= p[0]).sort((a, b) => a.scheduled_at - b.scheduled_at);
      }
      if (sql.includes("FROM sprint_round WHERE id = ?")) { const r = rounds.get(p[0]); return r ? [r] : []; }
      if (sql.includes("SUM(bid_paid)")) { const rid = p[0]; return [{ bids: entries.filter((e) => e.round_id === rid).reduce((a, e) => a + e.bid_paid, 0) }]; }
      if (sql.includes("SELECT user_id, bid_paid FROM sprint_entry")) { return entries.filter((e) => e.round_id === p[0]); }
      return [];
    },
    async execute(sql, p) {
      if (sql.includes("INSERT INTO sprint_round")) {
        rounds.set(p[0], { id: p[0], status: "scheduled", scheduled_at: p[1], bid: p[2], starting_stack: p[3], duration_ms: p[4], faucet_bps: p[5], entrants: 0, prize_pool: 0 });
        return { affectedRows: 1 };
      }
      if (sql.includes("status = 'done'")) { const r = rounds.get(p[2]); if (r) { r.status = "done"; r.prize_pool = p[0]; } return { affectedRows: 1 }; }
      if (sql.includes("status = 'canceled'")) { const r = rounds.get(p[1]); if (r) r.status = "canceled"; return { affectedRows: 1 }; }
      if (sql.startsWith("UPDATE sprint_round SET status")) { const r = rounds.get(p[p.length - 1]); if (r) { r.status = p[0]; if (sql.includes("started_at")) r.started_at = p[1]; } return { affectedRows: 1 }; }
      if (sql.includes("UPDATE sprint_entry SET final_stack")) { const e = entries.find((x) => x.round_id === p[3] && x.user_id === p[4]); if (e) { e.final_stack = p[0]; e.place = p[1]; e.prize = p[2]; } return { affectedRows: 1 }; }
      if (sql.includes("DELETE FROM sprint_entry")) { const i = entries.findIndex((e) => e.round_id === p[0] && e.user_id === p[1]); if (i >= 0) entries.splice(i, 1); return { affectedRows: i >= 0 ? 1 : 0 }; }
      return { affectedRows: 1 };
    },
  };
  return { db, wallet, rounds, entries };
}

test("dayRoundTimes returns two UTC round times at the configured hours", () => {
  const at = Date.UTC(2026, 7, 27, 9);
  const times = dayRoundTimes(at);
  assert.equal(times.length, 2);
  assert.deepEqual(times.map((t) => new Date(t).getUTCHours()), ROUND_HOURS_UTC);
});

test("ensureRounds creates the day's missing rounds and is idempotent", async () => {
  const { db, rounds } = makeStore();
  const at = Date.UTC(2026, 7, 27, 0, 30); // early in the day, both rounds still ahead
  const created = await ensureRounds(at, { db });
  assert.ok(created.length >= 2, "creates today's two rounds (plus tomorrow's)");
  const before = rounds.size;
  await ensureRounds(at, { db }); // second pass creates nothing new
  assert.equal(rounds.size, before);
});

test("runDue cancels an empty round and plays one with entrants", async () => {
  const { db, wallet, entries, rounds } = makeStore();
  // An empty round due now.
  rounds.set("empty", { id: "empty", status: "registering", scheduled_at: 1000, entrants: 0, faucet_bps: 3000 });
  // A populated round due now (2 humans).
  rounds.set("live1", { id: "live1", status: "registering", scheduled_at: 1000, entrants: 2, faucet_bps: 3000 });
  entries.push({ round_id: "live1", user_id: "h1", day_key: "d", bid_paid: 200, final_stack: null, place: null, prize: 0 });
  entries.push({ round_id: "live1", user_id: "h2", day_key: "d", bid_paid: 200, final_stack: null, place: null, prize: 0 });

  let ranWith = null;
  const runner = async (r) => {
    ranWith = r.id;
    return [
      { id: "h1", stack: 5000, isHuman: true },
      { id: "bot", stack: 3000, isHuman: false },
      { id: "h2", stack: 0, bustAt: 5, isHuman: true },
    ];
  };
  const out = await runDue(2000, runner, { db, wallet });

  assert.equal(rounds.get("empty").status, "canceled");
  assert.equal(ranWith, "live1", "runner played the populated round");
  assert.equal(rounds.get("live1").status, "done");
  const h1 = entries.find((e) => e.user_id === "h1");
  assert.equal(h1.place, 1); // top human
});

test("tick runs create + open + due in one pass without throwing", async () => {
  const { db, wallet } = makeStore();
  const out = await tick(Date.UTC(2026, 7, 27, 0, 30), async () => [], { db, wallet });
  assert.ok(Array.isArray(out));
});
