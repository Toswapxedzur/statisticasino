import { test } from "node:test";
import assert from "node:assert/strict";
import { tableSeats, outcomeOf, signed, deltaKind, cardWidth } from "./table-seats.js";

test("the seat map every table reads", () => {
  const view = { config: { maxSeats: 6 }, bankerSeat: 5, seats: [{ seat: 1, userId: 7 }, { seat: 5, userId: "bot", stack: 900 }] };
  const t = tableSeats(view, { id: 7 });
  assert.deepEqual(t.seatNos, [0, 1, 2, 3, 4, 5]);
  assert.equal(t.mySeatNo, 1);
  assert.ok(t.iAmSeated);
  assert.equal(t.cardW, 82);
  assert.equal(t.handSpace, 107);
  assert.deepEqual(t.house, { seat: 5, userId: "bot", stack: 900, name: "House" });
  const watching = tableSeats({ seats: [] }, null, 4);
  assert.equal(watching.mySeatNo, null);
  assert.equal(watching.seatNos.length, 4);
  assert.equal(watching.house.userId, "house", "a stand-in House before anyone banks");
  assert.deepEqual([6, 8, 9].map(cardWidth), [82, 70, 60]);
});

test("outcomes and signed amounts", () => {
  const results = [{ seat: 2, delta: 1200 }, { seat: 3, delta: -300 }];
  assert.equal(outcomeOf(results, 2).delta, 1200);
  assert.equal(outcomeOf(results, 4), null);
  assert.equal(outcomeOf(null, 2), null);
  assert.deepEqual([1200, -300, 0].map(signed), ["+1,200", "-300", "0"]);
  assert.deepEqual([1, -1, 0].map(deltaKind), ["win", "lose", "push"]);
});
