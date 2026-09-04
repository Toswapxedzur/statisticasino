import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, createHand, standardDeck } from "./poker/engine/index.js";
import { analyzePokerReplay, createStatsService } from "./stats.js";

function recordedHand() {
  const players = [
    { seat: 1, id: "u1", userId: "u1", name: "One", stack: 500 },
    { seat: 2, id: "u2", userId: "u2", name: "Two", stack: 500 },
    { seat: 3, id: "u3", userId: "u3", name: "Three", stack: 500 }
  ];
  const config = { players, buttonSeat: 1, smallBlind: 5, bigBlind: 10, variant: "holdem", deck: standardDeck() };
  let state = createHand(config);
  const actions = [];

  function act(type, amount) {
    const action = { seat: state.toActSeat, type };
    if (amount !== undefined) action.amount = amount;
    actions.push({ s: action.seat, t: actions.length * 100, type, ...(amount !== undefined ? { amount } : {}) });
    state = applyAction(state, action).state;
  }

  act("raise", 30); // seat 1: VPIP + PFR
  act("call");      // seat 2
  act("call");      // seat 3
  while (state.street !== "complete") {
    const menuSeat = state.toActSeat;
    if (menuSeat === null) break;
    act("check");
  }

  return {
    id: "r1",
    variant: "holdem",
    context: "cash",
    ended_at: 1_700_000_000_000,
    pot_total: 90,
    seat: 1,
    net: 60,
    replay_json: JSON.stringify({
      v: 1,
      mode: "holdem",
      variant: "holdem",
      config: { smallBlind: 5, bigBlind: 10, straddle: false, runItTwice: false },
      players: players.map(({ seat, userId, name, stack }) => ({ seat, userId, name, stack })),
      buttonSeat: 1,
      bankerSeat: null,
      deck: config.deck,
      actions,
      final: {
        result: { type: "showdown", revealed: [{ seat: 1 }, { seat: 2 }, { seat: 3 }] },
        nets: [{ seat: 1, net: 60 }, { seat: 2, net: -30 }, { seat: 3, net: -30 }]
      }
    })
  };
}

test("analyzePokerReplay re-simulates streets for VPIP and PFR", () => {
  const result = analyzePokerReplay(recordedHand());
  assert.equal(result.engineOk, true);
  assert.equal(result.preflopEligible, true);
  assert.equal(result.preflopValid, true);
  assert.equal(result.vpip, true);
  assert.equal(result.pfr, true);
  assert.equal(result.betsRaises, 1);
  assert.equal(result.calls, 0);
  assert.equal(result.showdownSeen, true);
  assert.equal(result.showdownWon, true);
  assert.equal(result.potWon, 90);
});

test("SQL aggregates normalise numeric rows and keep banker modes separate", async () => {
  const queryFn = async (sql, params) => {
    assert.equal(params[0], "u1");
    if (sql.includes("stats:overview-total")) {
      return [{ matches: "5", total_net: "125", days_active: "3", biggest_win: "90", wins: "3" }];
    }
    if (sql.includes("stats:overview-context")) {
      return [
        { context: "cash", matches: "4", net: "75", days_active: "2", biggest_win: "60", wins: "2" },
        { context: "tournament", matches: "1", net: "50", days_active: "1", biggest_win: "50", wins: "1" }
      ];
    }
    if (sql.includes("stats:mode-breakdown")) {
      return [
        { mode: "blackjack", role: "player", matches: "3", net: "25", wins: "2", biggest_win: "40", last_played: "1700" },
        { mode: "blackjack", role: "banker", matches: "2", net: "100", wins: "1", biggest_win: "120", last_played: "1600" }
      ];
    }
    if (sql.includes("stats:daily-net")) {
      return [{ day: "2026-09-04", net: "125", matches: "5" }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const stats = createStatsService(queryFn);
  const [overview, modes, daily] = await Promise.all([
    stats.overviewStats("u1", { sinceMs: 1000 }),
    stats.modeBreakdown("u1", { sinceMs: 1000 }),
    stats.dailyNet("u1", { sinceMs: 1000 })
  ]);

  assert.equal(overview.matches, 5);
  assert.equal(overview.totalNet, 125);
  assert.equal(overview.winRate, 60);
  assert.equal(overview.byContext.cash.matches, 4);
  assert.equal(overview.byContext.sprint.matches, 0);
  assert.deepEqual(modes.map((row) => row.role), ["player", "banker"]);
  assert.equal(modes[0].winRate, 66.7);
  assert.deepEqual(daily, [{ day: "2026-09-04", net: 125, matches: 5 }]);
});

test("pokerStats combines exact totals with cached replay-derived rates", async () => {
  let now = 10_000;
  let replayQueries = 0;
  const replay = recordedHand();
  const queryFn = async (sql) => {
    if (sql.includes("stats:poker-totals")) return [{ hands: "42", net: "900" }];
    if (sql.includes("stats:poker-replays")) {
      replayQueries += 1;
      return [replay];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const stats = createStatsService(queryFn, { now: () => now });

  const first = await stats.pokerStats("u1");
  assert.equal(first.hands, 42);
  assert.equal(first.net, 900);
  assert.equal(first.sampleHands, 1);
  assert.equal(first.vpip, 100);
  assert.equal(first.pfr, 100);
  assert.equal(first.showdownsSeen, 1);
  assert.equal(first.showdownsWon, 1);
  assert.equal(first.biggestPotWon, 90);
  assert.equal(first.aggressionFactor, null);

  await stats.pokerStats("u1");
  assert.equal(replayQueries, 1, "replay parsing query is cached for 60 seconds");
  now += 60_001;
  await stats.pokerStats("u1");
  assert.equal(replayQueries, 2, "cache expires after 60 seconds");
});
