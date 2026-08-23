// Decision-engine unit tests. These use clear-cut spots (the nuts, pure trash)
// so the direction of the decision is robust regardless of the Monte-Carlo
// noise draw — a seeded rng only makes them reproducible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./decide.js";
import { TIERS } from "./tiers.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A "facing a bet" spot with fold / call / raise / allin on the menu.
function facingBet({ hole, board, toCall, pot }) {
  return {
    hole, board,
    street: board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river",
    toCall, pot, currentBet: toCall, minRaise: toCall,
    myStack: 1000, myCommitted: 0, numOpponents: 1,
    actions: [
      { type: "fold" },
      { type: "call", amount: toCall },
      { type: "raise", min: toCall * 2, max: 1000 },
      { type: "allin", amount: 1000 }
    ]
  };
}

// A "checked to us" spot with fold / check / bet / allin on the menu.
function checkedTo({ hole, board, pot }) {
  return {
    hole, board,
    street: board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river",
    toCall: 0, pot, currentBet: 0, minRaise: 2,
    myStack: 1000, myCommitted: 0, numOpponents: 1,
    actions: [
      { type: "fold" },
      { type: "check" },
      { type: "bet", min: 2, max: 1000 },
      { type: "allin", amount: 1000 }
    ]
  };
}

test("raises the nuts (a set) facing a bet", () => {
  const obs = facingBet({ hole: ["As", "Ah"], board: ["Ad", "Kd", "Qs"], toCall: 50, pot: 100 });
  const a = decide(obs, TIERS.reg, mulberry32(1));
  assert.equal(a.type, "raise", `expected raise, got ${a.type}`);
  assert.ok(a.amount > 50 && a.amount <= 1000, `raise sized illegally: ${a.amount}`);
});

test("folds pure trash to a pot-sized bet", () => {
  const obs = facingBet({ hole: ["2c", "7d"], board: ["As", "Kh", "Qd"], toCall: 100, pot: 100 });
  const a = decide(obs, TIERS.reg, mulberry32(2));
  assert.equal(a.type, "fold", `expected fold, got ${a.type}`);
});

test("value-bets a strong made hand when checked to", () => {
  const obs = checkedTo({ hole: ["As", "Ah"], board: ["Ad", "Kd", "Qs"], pot: 100 });
  const a = decide(obs, TIERS.reg, mulberry32(3));
  assert.equal(a.type, "bet", `expected bet, got ${a.type}`);
  assert.ok(a.amount >= 2 && a.amount <= 1000, `bet sized illegally: ${a.amount}`);
});

test("checks a weak hand for free rather than folding", () => {
  const obs = checkedTo({ hole: ["2c", "7d"], board: ["As", "Kh", "Qd"], pot: 100 });
  const a = decide(obs, TIERS.reg, mulberry32(4));
  assert.equal(a.type, "check", `expected check, got ${a.type}`);
});

test("never folds when checking is free (fuzz across seeds and hands)", () => {
  const hands = [["2c", "7d"], ["As", "Ah"], ["9c", "8d"], ["Jh", "Ts"]];
  // Boards chosen to share no card with any hand above (equity() rejects dupes).
  const boards = [["Kd", "Qc", "4s"], ["3h", "5c", "6d"], ["Kc", "Kh", "2d"]];
  for (let s = 0; s < 20; s += 1) {
    for (const hole of hands) {
      for (const board of boards) {
        const obs = checkedTo({ hole, board, pot: 100 });
        const a = decide(obs, s % 2 ? TIERS.reg : TIERS.fish, mulberry32(s + 1));
        assert.notEqual(a.type, "fold", `folded for free: ${hole} on ${board}`);
      }
    }
  }
});

test("returns only actions that are on the legal menu", () => {
  const spots = [
    facingBet({ hole: ["As", "Ah"], board: ["Ad", "Kd", "Qs"], toCall: 50, pot: 100 }),
    facingBet({ hole: ["2c", "7d"], board: ["As", "Kh", "Qd"], toCall: 100, pot: 100 }),
    checkedTo({ hole: ["Kd", "Qd"], board: ["Jd", "Td", "2c"], pot: 100 })
  ];
  for (const obs of spots) {
    for (const tier of [TIERS.fish, TIERS.reg]) {
      for (let s = 0; s < 10; s += 1) {
        const a = decide(obs, tier, mulberry32(s * 7 + 1));
        const legal = obs.actions.some((m) => m.type === a.type);
        assert.ok(legal, `illegal action ${a.type} for menu ${obs.actions.map((m) => m.type)}`);
      }
    }
  }
});
