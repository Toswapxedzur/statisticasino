// Casino Hold'em tests: the one-decision loop, dealer qualification, the ante
// bonus, and banked settlement (deltas sum to zero).

import { test } from "node:test";
import assert from "node:assert/strict";
import { casinoHoldem } from "./casino-holdem.js";

const FILLER = ["2c", "3c", "4h", "5s", "6d", "7h", "8c"];

// One-player round with a rigged deck. Deal order: player[0],player[1] →
// dealer[2],dealer[3] → flop[4,5,6] → (finish) turn[7], river[8].
function runRound(deck, actions, stack = 1000, config) {
  const players = [{ seat: 1, userId: "u1", stack }];
  let state = casinoHoldem.startRound({ bankerSeat: 0, players, deck: [...deck, ...FILLER], config });
  const q = [...actions];
  let guard = 0;
  while (!casinoHoldem.isComplete(state)) {
    assert.ok(guard++ < 50, "round terminates");
    const seat = casinoHoldem.actorSeat(state);
    state = casinoHoldem.applyAction(state, q.shift() || casinoHoldem.defaultAction(state, seat)).state;
  }
  const results = casinoHoldem.settle(state);
  return { state, results, player: results.find((r) => r.seat === 1), banker: results.find((r) => r.seat === 0) };
}
const ANTE = (amount) => ({ seat: 1, type: "ante", amount });

test("call and beat a qualifying dealer pays ante + call", () => {
  // player As Ks → two pair AAKK; dealer 4d 4c → pair of 4s (qualifies); player wins.
  const deck = ["As", "Ks", "4d", "4c", "Ah", "Kd", "2c", "7s", "9h"];
  const { player, banker, results } = runRound(deck, [ANTE(10), { seat: 1, type: "call" }]);
  assert.equal(player.outcome, "win");
  assert.equal(player.delta, 30, "ante 10 + call 20");
  assert.equal(banker.delta, -30);
  assert.equal(results.reduce((s, r) => s + r.delta, 0), 0, "banked settle sums to zero");
});

test("folding loses only the ante", () => {
  const deck = ["As", "Ks", "4d", "4c", "Ah", "Kd", "2c", "7s", "9h"];
  const { player } = runRound(deck, [ANTE(10), { seat: 1, type: "fold" }]);
  assert.equal(player.outcome, "fold");
  assert.equal(player.delta, -10);
});

test("dealer not qualifying pays the ante and pushes the call", () => {
  // dealer 7d 2c on a K-high board → does not qualify; player pair of 9s.
  const deck = ["9s", "9h", "7d", "2c", "5d", "Tc", "3s", "Kh", "4d"];
  const { player, banker } = runRound(deck, [ANTE(10), { seat: 1, type: "call" }]);
  assert.equal(player.outcome, "no-qualify");
  assert.equal(player.delta, 10, "ante wins even money, call returned");
  assert.equal(banker.delta, -10);
});

test("ante bonus pays a royal flush", () => {
  // player As Ks + flop Qs Js Ts = royal flush; dealer junk (no qualify).
  const deck = ["As", "Ks", "2d", "7c", "Qs", "Js", "Ts", "3h", "8d"];
  const { player } = runRound(deck, [ANTE(10), { seat: 1, type: "call" }]);
  assert.equal(player.delta, 10 + 1000, "ante 10 + 100:1 royal bonus (1000)");
});

test("plays a full multi-round game, chips conserved", () => {
  // Two players + banker, always call; deck reshuffled per round by the harness.
  const seeds = ["Ah", "Kd"]; void seeds;
  const players = [{ seat: 1, userId: "a", stack: 1000 }, { seat: 2, userId: "b", stack: 1000 }];
  // A fixed shuffled-ish deck long enough for 2 players + dealer + board.
  const deck = casinoHoldem.deck();
  let state = casinoHoldem.startRound({ bankerSeat: 0, players, deck, config: { minBet: 5 } });
  let guard = 0;
  while (!casinoHoldem.isComplete(state)) {
    assert.ok(guard++ < 100, "terminates");
    const seat = casinoHoldem.actorSeat(state);
    const menu = casinoHoldem.legalActions(state);
    const act = menu.actions.some((a) => a.type === "ante")
      ? { seat, type: "ante", amount: 5 }
      : { seat, type: "call" };
    state = casinoHoldem.applyAction(state, act).state;
  }
  const results = casinoHoldem.settle(state);
  assert.equal(results.reduce((s, r) => s + r.delta, 0), 0, "conserved");
  assert.equal(results.length, 3, "two players + banker");
});
