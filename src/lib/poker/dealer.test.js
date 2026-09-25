import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { compileModule } from "svelte/compiler";
import { dealOrder, planDeal, DEAL, turnaroundMs, SHUFFLE_HAND_DELAY_MS } from "./deal-anim.js";

// dealer.svelte.js uses runes: compile it (client), point its relative imports back here, and
// load it from node_modules/.cache so `svelte/internal/...` resolves.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "dealer.svelte.js"), "utf8");
let js = compileModule(src, { filename: "dealer.svelte.js", generate: "client" }).js.code;
js = js.replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${pathToFileURL(join(here, f)).href}"`);
const cache = join(here, "../../../node_modules/.cache/dealer-test");
mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, "dealer.mjs"), js);
const clock = { t: 0 };
Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t }, configurable: true, writable: true });
const { Dealer } = await import(pathToFileURL(join(cache, "dealer.mjs")).href);

const run = (d, until, step = 16) => { while (clock.t < until) { clock.t += step; d.tick(clock.t); } };
const seat = (n, o = {}) => ({ seat: n, inHand: true, hasCards: true, status: "active", ...o });
const everyId = (d) => [...d.deck, ...d.used, ...d.flights.flatMap((f) => f.ids || [f.id]), ...d.held.map((h) => h.id)];

test("deal order: clockwise from the seat after the button, wrapping", () => {
  const seats = [0, 2, 5, 7].map((n) => seat(n)).concat([{ seat: 3, inHand: false, hasCards: false }]);
  assert.deepEqual(dealOrder(seats, 5), [7, 0, 2, 5]);
  assert.deepEqual(dealOrder(seats, 7), [0, 2, 5, 7]);
  const plan = planDeal([7, 0], 2);
  assert.deepEqual(plan.map((p) => [p.seat, p.slot, p.t0]), [[7, 0, 0], [0, 0, DEAL.every], [7, 1, 2 * DEAL.every], [0, 1, 3 * DEAL.every]]);
});

test("the between-hands pause covers collection + routine for the largest tables", () => {
  assert.ok(turnaroundMs(10 * 2 + 5) < SHUFFLE_HAND_DELAY_MS);
  assert.ok(turnaroundMs(9 * 5 + 5) < SHUFFLE_HAND_DELAY_MS);
});

test("a whole hand: deal, early fold, board, showdown, collection, routine — every card accounted for", () => {
  clock.t = 1000;
  const d = new Dealer({ variant: "holdem", mySeat: 0 });
  const idle = { handNo: 1, buttonSeat: 3, board: [], seats: [0, 1, 2, 3].map((n) => seat(n, { hasCards: false, inHand: false })) };
  d.init(idle);
  d.geom = { deckSpot: { fx: 12, fy: 80 }, usedSpot: { fx: 900, fy: 80 }, centre: { fx: 450, fy: 300 } };
  const h2 = { handNo: 2, buttonSeat: 3, board: [], seats: [0, 1, 2, 3].map((n) => seat(n)) };
  d.onView(idle, h2, null);
  assert.deepEqual([...d.hiddenSeats], [0, 1, 2, 3]);
  assert.equal(d.ownRevealed, false);
  // seat 2 folds while cards are still in the air (before its second card lands)
  run(d, 1000 + 150);
  const f2 = { ...h2, seats: h2.seats.map((s) => (s.seat === 2 ? { ...s, status: "folded" } : s)) };
  d.onView(h2, f2, { holeCards: ["As", "Kd"] });
  run(d, 3000);
  assert.equal(d.deck.length, 44);
  assert.ok(d.seatHidden(2), "a hand folded mid-deal stays hidden");
  assert.ok(!d.seatHidden(0) && !d.seatHidden(1) && !d.seatHidden(3));
  assert.equal(d.ownRevealed, true);
  assert.equal(d.used.length, 2, "exactly the folded seat's two cards reach the pile");
  assert.deepEqual(new Set(d.used), new Set(d._seatIds.get(2)));
  let ids = everyId(d).concat([...d._seatIds].filter(([s]) => s !== 2).flatMap(([, v]) => v));
  assert.equal(new Set(ids).size, 52);
  // flop, then a showdown result (the server clears hasCards with it)
  const flop = { ...f2, board: ["2c", "7d", "9h"] };
  d.onView(f2, flop, null);
  run(d, 4000);
  assert.deepEqual([d.boardShown, d.boardFaceUp], [3, 3]);
  assert.equal(d.deck.length, 41);
  const res = { ...flop, board: ["2c", "7d", "9h", "Jc", "Qs"], seats: flop.seats.map((s) => ({ ...s, hasCards: false })),
    result: { type: "showdown", revealed: [{ seat: 1, holeCards: ["3c", "3d"] }], winners: [{ seat: 1, amount: 10 }] } };
  d.onView(flop, res, { holeCards: ["Ah", "Ad"] });
  assert.equal(d.deck.length, 39, "the run-out board is taken from the deck");
  assert.equal(d.tableHidden, true);
  assert.equal(d.held.length, 3 * 2 + 5, "three live hands and the board are held on the canvas");
  assert.ok(d.held.filter((h) => h.at.kind === "seat" && h.at.seat === 3).every((h) => !h.faceUp), "unshown hands stay face-down");
  assert.ok(d.held.filter((h) => h.at.kind === "seat" && h.at.seat === 1).every((h) => h.faceUp));
  // just before the routine: all 52 in the used pile, once each
  let sawFull = false;
  while (!d.routine && clock.t < 12000) { clock.t += 8; d.tick(clock.t); if (!d.routine && d.used.length === 52) sawFull = new Set(d.used).size === 52; }
  assert.ok(sawFull, "the used pile holds all 52 cards when the shuffle starts");
  assert.ok(d.routine);
  run(d, clock.t + d.routine.R.duration + 50);
  assert.equal(d.routine, null);
  assert.equal(new Set(d.deck).size, 52);
  assert.ok(d.tableHidden, "the collected table stays hidden until the next hand");
  const h3 = { handNo: 3, buttonSeat: 0, board: [], seats: [0, 1, 2, 3].map((n) => seat(n)) };
  d.onView(res, h3, null);
  assert.equal(d.tableHidden, false);
  assert.equal(d.used.length, 0);
});
