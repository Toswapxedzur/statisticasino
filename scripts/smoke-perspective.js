// Smoke for the wire-format compatibility of perspective.js.
//
// Reproduces the bug from chat 2026-05-21 ("Settings -> Export all
// then upload, every hand rejected as generic") by feeding the
// detector REAL-SHAPE frames as captured by the extension.
//
// The four cases:
//
//   1. Real-shape frame: dealHoleCards.players[]                 -> hero detected
//   2. Legacy synthetic shape: dealHoleCards.seats[]             -> hero detected (back-compat)
//   3. No userIndex match + has userId on startHand seats[]      -> name = "User <uid>"
//   4. Neither userIndex nor seats userId                        -> name = "Seat <sid> @ <tid>"

import { detectPerspective, resolvePerspectivePlayer } from "../src/lib/server/perspective.js";

let pass = true;
function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK " : "BAD"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) pass = false;
}

function envelope(updates, opts = {}) {
  return {
    handKey: "T::H",
    handId: "H",
    tableId: opts.tableId || "T",
    firstTs: 1, lastTs: 2,
    frames: [{
      ts: 1, event: "output",
      payload: { handId: "H", updates }
    }]
  };
}

// 1. Real-shape `dealHoleCards.players[]`.
{
  const env = envelope([
    { action: "startHand", id: "H", seats: [
      { id: 3, userId: 1001 }, { id: 7, userId: 1002 }
    ] },
    { action: "dealHoleCards", players: [
      { seatId: 3, cards: ["Ah", "Kd"] },
      { seatId: 7, cards: ["X", "X"] }
    ] }
  ]);
  const persp = detectPerspective(env);
  expect("[1] real shape: hero seat",  persp && persp.seatId,        3);
  expect("[1] real shape: hero cards", persp && persp.holeCards,     ["Ah", "Kd"]);

  const resolved = resolvePerspectivePlayer(env, { "1001": "Alice" });
  expect("[1] resolved name",          resolved && resolved.name,    "Alice");
  expect("[1] resolved userId",        resolved && resolved.casinoUserId, 1001);
}

// 2. Legacy synthetic shape `dealHoleCards.seats[]`.
{
  const env = envelope([
    { action: "startHand", seats: [
      { id: 3, userId: 1001 }, { id: 7, userId: 1002 }
    ] },
    { action: "dealHoleCards", seats: [
      { seatId: 3, cards: ["Ah", "Kd"] },
      { seatId: 7, cards: ["X", "X"] }
    ] }
  ]);
  const persp = detectPerspective(env);
  expect("[2] legacy shape: hero seat",  persp && persp.seatId, 3);
}

// 3. Has userId in seats but no userIndex match -> "User <id>".
{
  const env = envelope([
    { action: "startHand", seats: [{ id: 5, userId: 9999 }] },
    { action: "dealHoleCards", players: [{ seatId: 5, cards: ["7c", "2d"] }] }
  ]);
  const resolved = resolvePerspectivePlayer(env, {});
  expect("[3] no userIndex match name",   resolved && resolved.name, "User 9999");
  expect("[3] no userIndex match userId", resolved && resolved.casinoUserId, 9999);
}

// 4. dealHoleCards present but no userId anywhere -> "Seat <s> @ <t>".
{
  const env = envelope([
    // No startHand at all (user joined mid-hand). dealHoleCards still
    // tells us seat 5 is the hero, but the envelope carries no
    // identity. Must NOT be rejected as generic.
    { action: "dealHoleCards", players: [{ seatId: 5, cards: ["7c", "2d"] }] }
  ], { tableId: "T9" });
  const resolved = resolvePerspectivePlayer(env, {});
  expect("[4] no-id name", resolved && resolved.name, "Seat 5 @ T9");
  expect("[4] no-id seat", resolved && resolved.seatId, 5);
  expect("[4] no-id uid",  resolved && resolved.casinoUserId, null);
}

if (!pass) process.exit(1);
console.log("perspective wire-format smokes pass.");
