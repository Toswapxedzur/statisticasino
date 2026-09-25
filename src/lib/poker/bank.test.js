import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { compileModule } from "svelte/compiler";

// bank.svelte.js uses runes: compile it (client), point its relative imports back here, and load
// it from node_modules/.cache so `svelte/internal/...` resolves (same as dealer.test.js).
const here = dirname(fileURLToPath(import.meta.url));
let js = compileModule(readFileSync(join(here, "bank.svelte.js"), "utf8"), { filename: "bank.svelte.js", generate: "client" }).js.code;
js = js.replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${pathToFileURL(join(here, f)).href}"`);
const cache = join(here, "../../../node_modules/.cache/bank-test");
mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, "bank.mjs"), js);
const clock = { t: 1000 };
Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t }, configurable: true, writable: true });
const { Bank, moneyKind, wagerOf } = await import(pathToFileURL(join(cache, "bank.mjs")).href);

// Feed a sequence of views; after each, let the coins run to rest WITHOUT the idle snap, and check
// the animation itself ended exactly where the server says (stacks, piles, pot).
function play(kind, views, gap = 1500) {
  const b = new Bank(kind);
  b.init(views[0]);
  for (let i = 1; i < views.length; i++) {
    clock.t += gap;
    b.onView(views[i - 1], views[i]);
    b.money.tick(clock.t + 30000);                 // everything lands; no snap involved
    const { stacks, piles } = b._expected(views[i]);
    for (const [k, v] of Object.entries(stacks)) assert.equal(b.money.stack.get(k === "house" ? "house" : +k) ?? 0, v, `view ${i}: stack ${k}`);
    for (const [k, v] of Object.entries(piles)) assert.equal(b.money.pileAt(k), v, `view ${i}: pile ${k}`);
    for (const k of b.money.piles.keys()) assert.equal(b.money.pileAt(k), piles[k] || 0, `view ${i}: stray pile ${k}`);
    clock.t += 30000;
  }
  return b;
}
const seat = (n, stack, extra = {}) => ({ seat: n, userId: "u" + n, stack, committed: 0, ...extra });

test("kinds and wagers", () => {
  assert.equal(moneyKind({ game: "blackjack", config: {} }), "banked");
  assert.equal(moneyKind({ game: "roulette", config: {} }), "banked");
  assert.equal(moneyKind({ config: { variant: "crazy-eights" } }), "shed");
  assert.equal(moneyKind({ config: { variant: "holdem" } }), "poker");
  const round = { hands: [{ seat: 1, bet: 10 }, { seat: 1, bet: 10 }, { seat: 2, ante: 5, call: 10 }], bets: [{ seat: 3, bets: [{ option: "red", amount: 4 }, { option: "7", amount: 1 }] }], tickets: [{ seat: 4, amount: 2 }] };
  assert.deepEqual([1, 2, 3, 4].map((s) => wagerOf(round, s)), [20, 15, 5, 2]);
});

test("poker: blinds, raise, calls, the flop sweep, a showdown pot to the winner", () => {
  const v0 = { handNo: 1, street: "preflop", potTotal: 3, result: null, seats: [seat(0, 200), seat(1, 199, { committed: 1 }), seat(2, 198, { committed: 2 })] };
  const v1 = { ...v0, potTotal: 11, seats: [seat(0, 192, { committed: 8 }), seat(1, 199, { committed: 1 }), seat(2, 198, { committed: 2 })] };
  const v2 = { ...v1, potTotal: 24, street: "flop", seats: [seat(0, 192), seat(1, 192), seat(2, 192)] };   // calls + street end in one view
  const v3 = { ...v2, potTotal: 44, seats: [seat(0, 172, { committed: 20 }), seat(1, 192), seat(2, 192)] };
  const v4 = { ...v3, potTotal: 64, street: "complete", result: { type: "showdown", winners: [{ seat: 2, amount: 64 }] }, seats: [seat(0, 172), seat(1, 192), seat(2, 236)] };
  play("poker", [v0, v1, v2, v3, v4]);
});

test("poker: everyone folds to a bet — the uncalled part goes home, the pot to the bettor", () => {
  const v0 = { handNo: 7, street: "flop", potTotal: 30, result: null, seats: [seat(0, 100), seat(1, 100)] };
  const v1 = { ...v0, potTotal: 70, seats: [seat(0, 60, { committed: 40 }), seat(1, 100)] };
  const v2 = { ...v1, potTotal: 30, street: "complete", result: { type: "uncontested", winners: [{ seat: 0, amount: 30 }] }, seats: [seat(0, 130), seat(1, 100)] };
  play("poker", [v0, v1, v2]);
});

test("poker: a new hand posts the blinds from the badges", () => {
  const done = { handNo: 1, street: "complete", potTotal: 10, result: { winners: [{ seat: 0, amount: 10 }] }, seats: [seat(0, 210), seat(1, 190)] };
  const next = { handNo: 2, street: "preflop", potTotal: 3, result: null, seats: [seat(0, 209, { committed: 1 }), seat(1, 188, { committed: 2 })] };
  play("poker", [done, next]);
});

test("banked: bets out, then the House pays a winner, takes a loser, a push goes home", () => {
  const seats = (a, b, c, h) => [seat(1, a), seat(2, b), seat(3, c), { seat: 5, userId: "bank", stack: h, isBanker: true }];
  const v0 = { game: "blackjack", handNo: 3, bankerSeat: 5, result: null, round: { hands: [] }, seats: seats(100, 100, 100, 5000) };
  const v1 = { ...v0, handNo: 4, round: { hands: [{ seat: 1, bet: 10 }, { seat: 2, bet: 25 }, { seat: 3, bet: 5 }] } };
  const v2 = { ...v1, round: { hands: [{ seat: 1, bet: 20 }, { seat: 2, bet: 25 }, { seat: 3, bet: 5 }] } };   // seat 1 doubles
  const res = { hands: v2.round.hands, results: [{ seat: 1, delta: 20, outcome: "win" }, { seat: 2, delta: -25, outcome: "lose" }, { seat: 3, delta: 0, outcome: "push" }, { seat: 5, delta: 5, outcome: "banker" }] };
  const v3 = { ...v2, result: res, round: res, seats: seats(120, 75, 100, 5005) };
  play("banked", [v0, v1, v2, v3]);
});

test("banked: a bet game (spots) and a loss bigger than the visible wager (hidden blind)", () => {
  const seats = (a, b) => [seat(1, a), seat(2, b)];
  const v0 = { game: "roulette", handNo: 1, bankerSeat: null, result: null, round: { betSelection: true, bets: [] }, seats: seats(100, 100) };
  const v1 = { ...v0, round: { betSelection: true, bets: [{ seat: 1, bets: [{ option: "red", amount: 5 }, { option: "17", amount: 1 }] }, { seat: 2, bets: [{ option: "black", amount: 3 }] }] } };
  const res = { ...v1.round, results: [{ seat: 1, delta: 30, outcome: "win" }, { seat: 2, delta: -7, outcome: "lose" }] };
  const v2 = { ...v1, result: res, round: res, seats: seats(130, 93) };
  play("banked", [v0, v1, v2]);
});

test("shed: antes into the pot, the winner takes it", () => {
  const cfg = { variant: "crazy-eights", minBet: 5 };
  const v0 = { config: cfg, handNo: 1, result: null, round: null, seats: [seat(0, 100), seat(1, 100), seat(2, 100)] };
  const v1 = { ...v0, handNo: 2, round: { shedGame: true, players: [{ seat: 0 }, { seat: 1 }, { seat: 2 }] } };
  const res = { shedGame: true, players: v1.round.players, winner: 1, results: [{ seat: 0, delta: -5 }, { seat: 1, delta: 10 }, { seat: 2, delta: -5 }] };
  const v2 = { ...v1, result: res, round: res, seats: [seat(0, 95), seat(1, 110), seat(2, 95)] };
  play("shed", [v0, v1, v2]);
});
