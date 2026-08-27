// Out-of-game friend voice calls: the call state machine (accept / decline /
// hang-up / busy / disconnect cleanup) driven through the hub with fake in-memory
// connections. The lifecycle methods are DB-free — we seed a ringing call directly
// (callInvite's friendship/DM lookups are covered by friends.js + conversations.js
// tests) and assert the exact CALL_STATE frames each socket receives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PokerHub } from "./hub.js";
import { S2C } from "../../poker/protocol.js";

function setup() {
  const hub = new PokerHub();
  const conns = {};
  const conn = (id) => {
    const frames = [];
    const c = { user: { id, displayName: id }, watching: new Set(), send(d) { frames.push(typeof d === "string" ? JSON.parse(d) : d); }, frames };
    conns[id] = c; hub.connections.add(c); return c;
  };
  return { hub, conn, conns };
}

// Seed a ringing call between a and b (bypassing the DB-backed invite).
function ring(hub, from = "a", to = "b") {
  const call = { id: "call1", from, to, state: "ringing", names: { [from]: "Alice", [to]: "Bob" }, convId: "conv1" };
  hub.calls.set(call.id, call);
  return call;
}

const callStates = (c) => c.frames.filter((f) => f.t === S2C.CALL_STATE);
const last = (c) => callStates(c).at(-1);

test("accept moves both parties to active with the shared room + ICE", async () => {
  const { hub, conn } = setup();
  const a = conn("a"), b = conn("b");
  ring(hub);
  await hub.callAccept(b, { callId: "call1" });

  const fa = last(a), fb = last(b);
  assert.equal(fa.state, "active");
  assert.equal(fb.state, "active");
  assert.equal(fa.room, "conv1");        // both join the DM's voice room
  assert.equal(fb.room, "conv1");
  assert.ok(Array.isArray(fa.iceServers)); // ICE handed over for the mesh
  assert.equal(fa.peer.userId, "b");      // a sees b as the peer
  assert.equal(fb.peer.userId, "a");
  assert.equal(hub.calls.get("call1").state, "active");
});

test("only the callee can accept", async () => {
  const { hub, conn } = setup();
  const a = conn("a"), b = conn("b");
  ring(hub);
  await hub.callAccept(a, { callId: "call1" }); // caller can't accept their own call
  assert.equal(callStates(a).length, 0);
  assert.equal(callStates(b).length, 0);
  assert.equal(hub.calls.get("call1").state, "ringing");
});

test("decline notifies the caller and drops the call", () => {
  const { hub, conn } = setup();
  const a = conn("a"), b = conn("b");
  ring(hub);
  hub.callDecline(b, { callId: "call1" });
  assert.equal(last(a).state, "declined");
  assert.equal(hub.calls.has("call1"), false);
});

test("hang-up notifies the OTHER party only", () => {
  const { hub, conn } = setup();
  const a = conn("a"), b = conn("b");
  ring(hub);
  hub.callEnd(a, { callId: "call1" }); // caller hangs up
  assert.equal(last(b).state, "ended"); // callee is told
  assert.equal(callStates(a).length, 0); // hanger-upper is not re-notified
  assert.equal(hub.calls.has("call1"), false);
});

test("a non-participant cannot end someone else's call", () => {
  const { hub, conn } = setup();
  conn("a"); conn("b");
  const c = conn("c");
  ring(hub);
  hub.callEnd(c, { callId: "call1" });
  assert.equal(hub.calls.get("call1")?.state, "ringing"); // untouched
  assert.equal(callStates(c).length, 0);
});

test("disconnect cleanup ends the call and tells the peer", () => {
  const { hub, conn, conns } = setup();
  const a = conn("a"), b = conn("b");
  ring(hub);
  // a drops entirely.
  hub.connections.delete(conns.a);
  hub._forgetCalls("a");
  assert.equal(last(b).state, "ended");
  assert.equal(hub.calls.has("call1"), false);
});

test("_callFor finds a party's active call (busy detection)", () => {
  const { hub, conn } = setup();
  conn("a"); conn("b");
  ring(hub);
  assert.equal(hub._callFor("a")?.id, "call1");
  assert.equal(hub._callFor("b")?.id, "call1");
  assert.equal(hub._callFor("z"), null);
});
