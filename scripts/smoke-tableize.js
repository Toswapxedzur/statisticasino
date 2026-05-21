// Smoke test for casinoMalwareExtension/tableize.js#detectHands.
//
// Loads tableize.js (a classic script that hangs `globalThis.CasinoTableize`)
// and exercises the v2 lifecycle rules from chat 2026-05-21:
//
//   1. start + finish                 -> 1 hand,  finished
//   2. start, then a NEW startHand    -> 2 hands, [incomplete, in-progress]
//   3. start, then frame for a NEW
//      handId without its startHand   -> 1 hand,  incomplete
//                                        (the foreign frame is dropped,
//                                        not turned into a hand)
//   4. frame for an OLD/closed handId
//      after the next start arrived   -> the old-handId frame is dropped
//                                        and does NOT extend either hand
//   5. frames before any startHand    -> 0 hands

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const tableizeSrc = readFileSync(
  resolve(here, "../../casinoMalwareExtension/tableize.js"),
  "utf8"
);

// Run the IIFE in a fresh sandbox so we get a clean CasinoTableize.
const sandbox = { console };
sandbox.self = sandbox;          // matches the IIFE's `root` argument
vm.createContext(sandbox);
vm.runInContext(tableizeSrc, sandbox);
const Tableize = sandbox.CasinoTableize;
if (!Tableize) throw new Error("CasinoTableize did not load");

// ---------- helpers ---------- //

let nextTs = 1;
function frame(updates, handId) {
  return {
    ts: nextTs++,
    event: "output",
    payload: {
      handId,
      updates: updates.map((u) => ({ handId, ...u }))
    }
  };
}
function table(frames) {
  return { tableId: "T", frames };
}

let pass = true;
function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK " : "BAD"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) pass = false;
}

// ---------- 1. start + finish -> finished ---------- //
{
  const t = table([
    frame([{ action: "startHand" }], "A"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["Ah", "Ks"] }] }], "A"),
    frame([{ action: "finishHand" }], "A"),
  ]);
  const hands = Tableize.detectHands(t);
  expect("[1] hand count",  hands.length, 1);
  expect("[1] lifecycle",   hands[0].lifecycle, "finished");
  expect("[1] handId",      hands[0].handId, "A");
}

// ---------- 2. start, new startHand without finish -> incomplete + in-progress ---------- //
{
  const t = table([
    frame([{ action: "startHand" }], "A"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["Ah", "Ks"] }] }], "A"),
    frame([{ action: "startHand" }], "B"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["2c", "3d"] }] }], "B"),
  ]);
  const hands = Tableize.detectHands(t);
  expect("[2] hand count", hands.length, 2);
  expect("[2] A.lifecycle", hands[0].lifecycle, "incomplete");
  expect("[2] B.lifecycle", hands[1].lifecycle, "in-progress");
}

// ---------- 3. start A, then frame for new handId B without its startHand
//             -> A becomes incomplete, B is NOT created (foreign frame dropped) ---------- //
{
  const t = table([
    frame([{ action: "startHand" }], "A"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["Ah", "Ks"] }] }], "A"),
    // server jumped to hand B but its startHand never reached us
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["2c", "3d"] }] }], "B"),
  ]);
  const hands = Tableize.detectHands(t);
  expect("[3] hand count", hands.length, 1);
  expect("[3] A.lifecycle", hands[0].lifecycle, "incomplete");
  expect("[3] no B-hand created", hands.find((h) => h.handId === "B"), undefined);
}

// ---------- 4. frame for OLD handId arrives after the new hand has opened
//             -> the old-handId frame is ignored; doesn't extend either ---------- //
{
  const t = table([
    frame([{ action: "startHand" }], "A"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["Ah", "Ks"] }] }], "A"),
    frame([{ action: "finishHand" }], "A"),
    frame([{ action: "startHand" }], "B"),
    // late drift from the closed hand A — must be ignored
    frame([{ action: "bet", chips: 100 }], "A"),
    frame([{ action: "dealHoleCards", seats: [{ seatId: 1, cards: ["2c", "3d"] }] }], "B"),
  ]);
  const hands = Tableize.detectHands(t);
  expect("[4] hand count",      hands.length, 2);
  expect("[4] A.lifecycle",     hands[0].lifecycle, "finished");
  // The drift action should NOT be counted in either hand. A's
  // actionCount: startHand + dealHoleCards + finishHand = 3.
  expect("[4] A.actionCount",   hands[0].actionCount, 3);
  // B's actionCount: startHand + dealHoleCards = 2 (the drift "bet" was dropped).
  expect("[4] B.actionCount",   hands[1].actionCount, 2);
}

// ---------- 5. frames before any startHand -> 0 hands ---------- //
{
  const t = table([
    // user joined mid-hand; no startHand observed
    frame([{ action: "dealCommunityCards", cards: ["Ah", "Ks", "Qd"] }], "X"),
    frame([{ action: "bet", chips: 100 }], "X"),
    // ... and then disconnected before a startHand could open the next hand
  ]);
  const hands = Tableize.detectHands(t);
  expect("[5] hand count", hands.length, 0);
}

if (!pass) process.exit(1);
console.log("all tableize lifecycle smokes pass.");
