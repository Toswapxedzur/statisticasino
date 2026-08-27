// Achievements: the pure trigger logic (streak + hand → keys) and idempotent
// unlock/list against an in-memory db mock (no MySQL needed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, streakAchievements, handAchievements, unlock, unlockAndReward, listForUser, progressFor } from "./achievements.js";

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

test("progressFor reports ladder progress and null for non-ladder badges", () => {
  assert.deepEqual(progressFor("hands_1000", { handsPlayed: 250 }), { value: 250, target: 1000 });
  assert.deepEqual(progressFor("hands_100", { handsPlayed: 5000 }), { value: 100, target: 100 }); // capped
  assert.deepEqual(progressFor("streak_7", { streak: 4 }), { value: 4, target: 7 });
  assert.equal(progressFor("first_win", { handsPlayed: 10 }), null);
  assert.equal(progressFor("nope", {}), null);
});

test("handAchievements adds the new gold-tier ladders", () => {
  const whale = handAchievements({ won: true, potWon: 12000, handsPlayed: 10000 });
  assert.ok(whale.includes("hands_10000"));
  assert.ok(whale.includes("whale_pot"));
  assert.ok(whale.includes("big_pot"));
  // Below thresholds: no gold tiers.
  const mid = handAchievements({ won: true, potWon: 1500, handsPlayed: 100 });
  assert.ok(!mid.includes("whale_pot"));
  assert.ok(!mid.includes("hands_10000"));
});

test("unlockAndReward pays each newly-unlocked reward exactly once", async () => {
  const db = makeDb();
  const credited = [];
  const wallet = { credit: async (u, a, r, ref) => { credited.push({ u, a, r, ref }); return 1; } };

  const fresh = await unlockAndReward("u9", ["first_hand", "big_pot"], db, wallet);
  assert.deepEqual(fresh.sort(), ["big_pot", "first_hand"]);
  // Two reward-bearing badges → two credits, matching the catalog amounts.
  assert.equal(credited.length, 2);
  const byKey = Object.fromEntries(credited.map((c) => [c.ref, c.a]));
  assert.equal(byKey["ach:first_hand"], ACHIEVEMENTS.find((x) => x.key === "first_hand").reward);
  assert.equal(byKey["ach:big_pot"], ACHIEVEMENTS.find((x) => x.key === "big_pot").reward);

  // Re-running unlocks nothing new, so no further credits.
  const again = await unlockAndReward("u9", ["first_hand", "big_pot"], db, wallet);
  assert.deepEqual(again, []);
  assert.equal(credited.length, 2);
});
