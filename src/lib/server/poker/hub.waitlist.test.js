// Waitlist for full tables: queueing, FIFO auto-seating when a seat opens,
// skipping candidates who left, and disconnect cleanup. Uses a light fake table
// (real seating semantics without the engine) and drives the hub directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PokerHub } from "./hub.js";

function fakeTable(id, maxSeats = 2) {
  const seats = new Map();
  return {
    id, _closed: false,
    config: { maxSeats, minBuyin: 40, maxBuyin: 200, bigBlind: 2, name: "Full Table" },
    seats,
    seatForUser(uid) { return [...seats.values()].find((s) => s.userId === uid) || null; },
    addWatcher() {},
    async sit(conn, seat, buyin) { seats.set(seat, { seat, userId: conn.user.id, stack: buyin }); }
  };
}

// A hub with a fresh table; connections tracked so connsForUser works.
function setup(maxSeats = 2) {
  const hub = new PokerHub();
  const table = fakeTable("t1", maxSeats);
  hub.tables.set(table.id, table);
  const conns = {};
  const conn = (id) => {
    const frames = [];
    const c = { user: { id, displayName: id }, watching: new Set(), send(d) { frames.push(typeof d === "string" ? JSON.parse(d) : d); }, frames };
    conns[id] = c; hub.connections.add(c); return c;
  };
  return { hub, table, conn, conns };
}

test("joining a full table queues you; an open seat auto-fills FIFO", async () => {
  const { hub, table, conn } = setup(2);
  // Fill both seats.
  await table.sit(conn("a"), 0, 100);
  await table.sit(conn("b"), 1, 100);
  // Two more queue up.
  await hub.joinWaitlist(conn("c"), table, 120);
  await hub.joinWaitlist(conn("d"), table, 120);
  assert.deepEqual(hub.waitlistFor("t1").map((e) => e.userId), ["c", "d"]);

  // Seat b stands → head of the queue (c) is seated.
  table.seats.delete(1);
  await hub.processWaitlist(table);
  assert.ok(table.seatForUser("c"), "c took the open seat");
  assert.deepEqual(hub.waitlistFor("t1").map((e) => e.userId), ["d"], "d still waiting");
});

test("a candidate who disconnected is skipped", async () => {
  const { hub, table, conn, conns } = setup(2);
  await table.sit(conn("a"), 0, 100);
  await table.sit(conn("b"), 1, 100);
  await hub.joinWaitlist(conn("c"), table, 120);
  await hub.joinWaitlist(conn("d"), table, 120);
  // c drops before a seat opens.
  hub.connections.delete(conns.c);
  hub._forgetWaitlists("c"); // removeConnection does this on last conn

  table.seats.delete(0);
  await hub.processWaitlist(table);
  assert.ok(table.seatForUser("d"), "d (next live) got the seat");
  assert.ok(!table.seatForUser("c"), "c was skipped");
});

test("you can't waitlist a table that has room, or one you're seated at", async () => {
  const { hub, table, conn } = setup(2);
  await table.sit(conn("a"), 0, 100);
  await hub.joinWaitlist(conn("b"), table, 120); // room exists → refused
  assert.equal(hub.waitlistFor("t1").length, 0);
  // Fill it, then a seated player tries to waitlist.
  await table.sit(conn("b"), 1, 100);
  await hub.joinWaitlist(conn("a"), table, 120); // already seated → refused
  assert.equal(hub.waitlistFor("t1").length, 0);
});
