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

// ---- non-poker games ----
const bj = (round, extra = {}) => ({ id: "b1", game: "blackjack", handNo: 1, result: null, seats: [seat(1, "u1"), seat(2, "u2")], round, ...extra });

test("blackjack: new round shuffles and deals every card; a hit deals one", () => {
  const a = bj({ phase: "bet", hands: [], dealer: { cards: [] } }, { handNo: 1 });
  const b = bj({ phase: "act", hands: [{ seat: 1, cards: ["Ah", "9d"] }, { seat: 2, cards: ["5c", "5s"] }], dealer: { cards: ["Kd", "X"] } }, { handNo: 2 });
  const cues = tableSoundCues(a, b, "u1");
  assert.deepEqual(names(cues), ["shuffle", "deal"]);
  assert.equal(cues[1].count, 6);
  const c = bj({ ...b.round, hands: [{ seat: 1, cards: ["Ah", "9d", "2c"] }, b.round.hands[1]] }, { handNo: 2 });
  assert.deepEqual(names(tableSoundCues(b, c, "u1")), ["deal"]);
});

test("blackjack settlement: win jingle for me, lose for a loser, pot for a watcher", () => {
  const a = bj({ phase: "act", hands: [{ seat: 1, cards: ["Ah", "Kd"] }], dealer: { cards: ["9c", "X"] }, results: [] });
  const b = bj({ ...a.round, dealer: { cards: ["9c", "7d"] }, results: [{ seat: 1, delta: 30, outcome: "blackjack" }, { seat: 2, delta: -10, outcome: "lose" }] });
  assert.deepEqual(names(tableSoundCues(a, b, "u1")), ["board", "winChips", "win"]); // dealer's hole card flips
  assert.deepEqual(names(tableSoundCues(a, b, "u2")), ["board", "lose"]);
  assert.deepEqual(names(tableSoundCues(a, b, null)), ["board", "pot"]);
});

test("roulette: chips placed, then a spin and ball drop when the outcome lands", () => {
  const base = { id: "r1", game: "roulette", handNo: 1, result: null, seats: [seat(1, "u1")] };
  const a = { ...base, round: { betSelection: true, bets: [{ seat: 1, bets: [] }], outcome: null, results: [] } };
  const b = { ...base, round: { ...a.round, bets: [{ seat: 1, bets: [{ type: "red", amount: 5 }] }] } };
  assert.deepEqual(names(tableSoundCues(a, b, "u1")), ["bet"]);
  const c = { ...base, round: { ...b.round, outcome: { pocket: 17, color: "black" }, results: [{ seat: 1, delta: -5, outcome: "lose" }] } };
  assert.deepEqual(names(tableSoundCues(b, c, "u1")), ["shake", "dice", "lose"]);
});

test("sic bo rolls dice, slots spin reels, keno draws numbers", () => {
  const mk = (game, round, handNo = 1) => ({ id: game, game, handNo, result: null, seats: [seat(1, "u1")], round });
  const s0 = mk("sic-bo", { bets: [], outcome: null, results: [] }), s1 = mk("sic-bo", { bets: [], outcome: { dice: [1, 2, 3] }, results: [] });
  assert.deepEqual(names(tableSoundCues(s0, s1, "u1")), ["shake", "dice"]);
  const l0 = mk("slots", { bets: [], outcome: null, results: [] }), l1 = mk("slots", { bets: [], outcome: { reels: ["7", "7", "bar"] }, results: [] });
  assert.deepEqual(names(tableSoundCues(l0, l1, "u1")), ["reel"]);
  const k0 = mk("keno", { drawn: [], tickets: [], results: [] }), k1 = mk("keno", { drawn: [4, 9, 23], tickets: [], results: [] });
  const kc = tableSoundCues(k0, k1, "u1");
  assert.deepEqual(names(kc), ["board"]); assert.equal(kc[0].count, 3);
});

test("crazy eights: a card played hits the pile, a draw deals", () => {
  const mk = (round) => ({ id: "c8", game: "crazy-eights", handNo: 1, result: null, seats: [seat(1, "u1"), seat(2, "u2")], round });
  const a = mk({ pile: ["7h"], top: "7h", players: [{ seat: 1, count: 5 }, { seat: 2, count: 5 }] });
  const b = mk({ pile: ["7h", "7s"], top: "7s", players: [{ seat: 1, count: 4 }, { seat: 2, count: 5 }] });
  assert.deepEqual(names(tableSoundCues(a, b, "u1")), ["board"]);
  const c = mk({ ...b.round, drawCount: 1, players: [{ seat: 1, count: 4 }, { seat: 2, count: 6 }] });
  assert.deepEqual(names(tableSoundCues(b, c, "u1")), ["deal"]); // seat 2 drew one card
});
