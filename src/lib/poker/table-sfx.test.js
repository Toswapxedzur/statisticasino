import test from "node:test";
import assert from "node:assert/strict";
import { tableSoundCues } from "./table-sfx.js";

const seat = (n, userId, extra = {}) => ({ seat: n, userId, hasCards: true, inHand: true, lastAction: null, ...extra });
const base = () => ({
  id: "t1", handNo: 3, street: "preflop", board: [], result: null,
  seats: [seat(1, "u1"), seat(2, "u2"), seat(3, "u3")]
});
const names = (cues) => cues.map((c) => c.name);

test("first snapshot is silent", () => {
  assert.deepEqual(tableSoundCues(null, base(), "u1"), []);
});

test("new hand: shuffle then a deal burst, nothing else", () => {
  const a = base(), b = { ...base(), handNo: 4, seats: [seat(1, "u1", { lastAction: "SB" }), seat(2, "u2", { lastAction: "BB" }), seat(3, "u3")] };
  const cues = tableSoundCues(a, b, "u1");
  assert.deepEqual(names(cues), ["shuffle", "deal"]);
  assert.equal(cues[1].count, 6);
});

test("betting actions map from lastAction labels; blinds are silent", () => {
  const a = base();
  const b = { ...base(), seats: [seat(1, "u1", { lastAction: "Raise 40" }), seat(2, "u2", { lastAction: "Fold" }), seat(3, "u3", { lastAction: "BB" })] };
  assert.deepEqual(names(tableSoundCues(a, b, "u2")), ["raise", "fold"]);
  const c = { ...b, seats: [seat(1, "u1", { lastAction: "Raise 40" }), seat(2, "u2", { lastAction: "Fold" }), seat(3, "u3", { lastAction: "Call" })] };
  assert.deepEqual(names(tableSoundCues(b, c, "u2")), ["bet"]);            // only the changed seat
  const d = { ...c, seats: [seat(1, "u1", { lastAction: "All-in" }), ...c.seats.slice(1)] };
  assert.deepEqual(names(tableSoundCues(c, d, "u2")), ["allin"]);
});

test("street change sweeps the pot and places the new board cards", () => {
  const a = base();
  const b = { ...base(), street: "flop", board: ["Ah", "Kd", "7c"] };
  const cues = tableSoundCues(a, b, "u1");
  assert.deepEqual(names(cues), ["board", "pot"]);
  assert.equal(cues[0].count, 3);
});

test("hand end: showdown reveal, chips to winner, jingle only for the winner", () => {
  const a = { ...base(), street: "river", board: ["Ah", "Kd", "7c", "2s", "9h"] };
  const b = { ...a, street: "complete", result: { type: "showdown", winners: [{ seat: 2, amount: 300 }], revealed: [{ seat: 2 }, { seat: 1 }] } };
  assert.deepEqual(names(tableSoundCues(a, b, "u2")), ["showdown", "winChips", "win"]);
  assert.deepEqual(names(tableSoundCues(a, b, "u1")), ["showdown", "winChips"]);
  const fold = { ...a, street: "complete", result: { type: "fold", winners: [{ seat: 1, amount: 60 }] } };
  assert.deepEqual(names(tableSoundCues(a, fold, "u3")), ["winChips"]);
});

test("players joining and leaving", () => {
  const a = base();
  const b = { ...base(), seats: [...base().seats, seat(4, "u4")] };
  assert.deepEqual(names(tableSoundCues(a, b, "u1")), ["join"]);
  assert.deepEqual(names(tableSoundCues(b, a, "u1")), ["leave"]);
});
