// Achievements: the pure trigger logic (streak + hand → keys) and idempotent
// unlock/list against an in-memory db mock (no MySQL needed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, streakAchievements, handAchievements, unlock, listForUser } from "./achievements.js";

// Minimal db mock mirroring db.js's { query, execute } with a user_achievement set.
function makeDb() {
  const rows = []; // { user_id, achievement, unlocked_at }
  return {
    rows,
    async execute(sql, params) {
      // Only INSERT IGNORE into user_achievement is used here.
      const [uid, ach, at] = params;
      if (rows.some((r) => r.user_id === uid && r.achievement === ach)) return { affectedRows: 0 };
      rows.push({ user_id: uid, achievement: ach, unlocked_at: at });
      return { affectedRows: 1 };
    },
    async query(sql, params) {
      const [uid] = params;
      return rows.filter((r) => r.user_id === uid);
    }
  };
}

test("streak milestones are cumulative", () => {
  assert.deepEqual(streakAchievements(1), []);
  assert.deepEqual(streakAchievements(3), ["streak_3"]);
  assert.deepEqual(streakAchievements(9), ["streak_3", "streak_7"]);
  assert.deepEqual(streakAchievements(30), ["streak_3", "streak_7", "streak_30"]);
});

test("hand achievements reflect the outcome", () => {
  // A losing first hand earns only 'first_hand'.
  assert.deepEqual(handAchievements({ won: false, handsPlayed: 1 }), ["first_hand"]);
  // A winning all-in bot pot over 1k earns the lot.
  const big = handAchievements({ won: true, vsBot: true, allInWin: true, potWon: 1500, handsPlayed: 100 });
  assert.ok(big.includes("first_win") && big.includes("bot_slayer") && big.includes("all_in_win"));
  assert.ok(big.includes("big_pot") && big.includes("hands_100"));
  // A small won pot without the extras: no big_pot / bot_slayer / all_in_win.
  const small = handAchievements({ won: true, vsBot: false, allInWin: false, potWon: 200, handsPlayed: 5 });
  assert.deepEqual(small.sort(), ["first_hand", "first_win"]);
});

test("unlock is idempotent and reports only newly-unlocked keys", async () => {
  const db = makeDb();
  const first = await unlock("u1", ["first_hand", "first_win"], db);
  assert.deepEqual(first.sort(), ["first_hand", "first_win"]);
  // Re-unlocking the same + one new key returns only the new one.
  const second = await unlock("u1", ["first_hand", "first_win", "big_pot"], db);
  assert.deepEqual(second, ["big_pot"]);
  // Unknown keys are ignored.
  assert.deepEqual(await unlock("u1", ["not_a_real_key"], db), []);
});

test("listForUser annotates the full catalog with unlocked state", async () => {
  const db = makeDb();
  await unlock("u2", ["first_hand"], db);
  const list = await listForUser("u2", db);
  assert.equal(list.length, ACHIEVEMENTS.length, "returns the whole catalog");
  const fh = list.find((a) => a.key === "first_hand");
  const fw = list.find((a) => a.key === "first_win");
  assert.equal(fh.unlocked, true);
  assert.ok(fh.unlockedAt > 0);
  assert.equal(fw.unlocked, false);
  assert.equal(fw.unlockedAt, null);
});
