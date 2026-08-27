// Quest engine tests — period bucketing, progress capping, and claim idempotency.
// A tiny in-memory `db` mock recognizes the three exact statements quests.js runs
// and applies their intended semantics, so the real logic is exercised without MySQL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { periodKey, recordEvent, activeQuestsFor, claim, QUESTS } from "./quests.js";

function makeDb() {
  const rows = new Map(); // "user|quest|pk" -> { user_id, quest_id, period_key, progress, claimed_at }
  return {
    rows,
    async execute(sql, p) {
      if (sql.includes("INSERT INTO quest_progress")) {
        const [userId, questId, pk, seed, , target, amount] = p;
        const key = `${userId}|${questId}|${pk}`;
        const cur = rows.get(key);
        if (!cur) rows.set(key, { user_id: userId, quest_id: questId, period_key: pk, progress: seed, claimed_at: null });
        else cur.progress = Math.min(target, cur.progress + amount);
        return { affectedRows: 1 };
      }
      if (sql.includes("UPDATE quest_progress SET claimed_at")) {
        const [at, userId, questId, pk, target] = p;
        const cur = rows.get(`${userId}|${questId}|${pk}`);
        if (cur && cur.claimed_at == null && cur.progress >= target) { cur.claimed_at = at; return { affectedRows: 1 }; }
        return { affectedRows: 0 };
      }
      throw new Error("unexpected execute: " + sql);
    },
    async query(sql, p) {
      if (sql.includes("SELECT quest_id, period_key, progress, claimed_at")) {
        const [userId] = p;
        return [...rows.values()].filter((r) => r.user_id === userId);
      }
      throw new Error("unexpected query: " + sql);
    },
  };
}

const AT = Date.UTC(2026, 7, 27, 12, 0, 0); // 2026-08-27 (a Thursday)

test("periodKey buckets by day / week / month in UTC", () => {
  assert.equal(periodKey("daily", AT), "2026-08-27");
  assert.equal(periodKey("monthly", AT), "2026-08");
  assert.match(periodKey("weekly", AT), /^\d{4}-W\d{2}$/);
  // Same ISO week is stable; a week later differs.
  assert.equal(periodKey("weekly", AT), periodKey("weekly", AT + 2 * 86400000));
  assert.notEqual(periodKey("weekly", AT), periodKey("weekly", AT + 7 * 86400000));
});

test("recordEvent advances matching quests and caps at target", async () => {
  const db = makeDb();
  // d_win_3 target 3. Three wins completes it; a fourth never exceeds target.
  for (let i = 0; i < 4; i++) await recordEvent("u1", "pots_won", 1, db, AT);
  const q = (await activeQuestsFor("u1", db, AT)).find((x) => x.id === "d_win_3");
  assert.equal(q.progress, 3);
  assert.equal(q.done, true);
  assert.equal(q.claimed, false);
});

test("a large single event is capped to the quest target", async () => {
  const db = makeDb();
  await recordEvent("u2", "chips_won", 999999, db, AT); // no chips_won quest in catalog → no-op is fine
  // hands_played does exist; a big amount caps at daily target (10).
  await recordEvent("u2", "hands_played", 999, db, AT);
  const daily = (await activeQuestsFor("u2", db, AT)).find((x) => x.id === "d_play_10");
  assert.equal(daily.progress, 10);
  assert.equal(daily.done, true);
});

test("claim pays once and is idempotent", async () => {
  const db = makeDb();
  const credited = [];
  const wallet = { credit: async (u, a, r, ref) => { credited.push({ u, a, r, ref }); return 5000; } };

  // Not claimable before completion.
  let res = await claim("u3", "d_win_3", db, wallet, AT);
  assert.equal(res.ok, false);
  assert.equal(res.error, "not_claimable");

  for (let i = 0; i < 3; i++) await recordEvent("u3", "pots_won", 1, db, AT);

  res = await claim("u3", "d_win_3", db, wallet, AT);
  assert.equal(res.ok, true);
  const reward = QUESTS.find((q) => q.id === "d_win_3").reward;
  assert.equal(res.reward, reward);
  assert.equal(credited.length, 1);
  assert.equal(credited[0].a, reward);

  // Second claim in the same period is rejected and does NOT pay again.
  res = await claim("u3", "d_win_3", db, wallet, AT);
  assert.equal(res.ok, false);
  assert.equal(credited.length, 1);
});

test("claim rejects an unknown quest id", async () => {
  const db = makeDb();
  const res = await claim("u4", "nope", db, { credit: async () => 0 }, AT);
  assert.equal(res.ok, false);
  assert.equal(res.error, "unknown_quest");
});
