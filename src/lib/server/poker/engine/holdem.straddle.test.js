// Straddle: a live 2xBB blind from the seat left of the BB that becomes the bet to
// match and takes last preflop action (its poster keeps the option).

import test from "node:test";
import assert from "node:assert/strict";
import { standardDeck } from "./cards.js";
import { applyAction, createHand, legalActions } from "./holdem.js";

function hand({ stacks = [100, 100, 100], buttonSeat = 1, bigBlind = 10, straddle = true } = {}) {
  return createHand({
    players: stacks.map((s, i) => ({ id: `p${i + 1}`, seat: i + 1, stack: s })),
    buttonSeat, smallBlind: bigBlind / 2, bigBlind, straddle, deck: standardDeck()
  });
}
const chips = (st) => st.players.reduce((s, p) => s + p.stack + p.totalCommitted, 0);
const seat = (st, n) => st.players.find((p) => p.seat === n);

test("the seat left of the BB posts a 2xBB straddle that sets the current bet", () => {
  const st = hand(); // 3-handed, button=1 → SB=2, BB=3, straddle=UTG=seat1
  const blinds = st.initialEvents.find((e) => e.type === "blindsPosted");
  assert.deepEqual(blinds.straddle, { seat: 1, amount: 20 }, "straddle posted by UTG");
  assert.equal(st.currentBet, 20, "current bet is the straddle");
  assert.equal(seat(st, 1).committedThisStreet, 20, "straddler committed 2xBB");
  assert.equal(st.toActSeat, 2, "action opens left of the straddle (the SB)");
  assert.equal(chips(st), 300, "chips conserved");
});

test("the straddler keeps the option — action comes back to them, and they can check or raise", () => {
  let st = hand();
  st = applyAction(st, { seat: 2, type: "call" }).state; // SB calls to 20
  st = applyAction(st, { seat: 3, type: "call" }).state; // BB calls to 20
  assert.equal(st.toActSeat, 1, "back to the straddler");
  const menu = legalActions(st);
  const types = menu.actions.map((a) => a.type);
  assert.ok(types.includes("check"), "straddler has the option to check");
  assert.ok(types.includes("raise"), "…or raise");
  // Exercising the option to check closes the round; conservation holds.
  st = applyAction(st, { seat: 1, type: "check" }).state;
  assert.equal(st.street, "flop");
  assert.equal(chips(st), 300);
});

test("no straddle heads-up, or when the straddler can't cover it in full", () => {
  const hu = hand({ stacks: [100, 100], buttonSeat: 1 });
  assert.equal(hu.initialEvents.find((e) => e.type === "blindsPosted").straddle, null, "no straddle heads-up");
  assert.equal(hu.currentBet, 10, "current bet is just the BB");

  // 3-handed but UTG (seat 1) has less than 2xBB — straddle is skipped.
  const poor = hand({ stacks: [15, 100, 100], buttonSeat: 1 });
  assert.equal(poor.initialEvents.find((e) => e.type === "blindsPosted").straddle, null, "short stack can't straddle");
  assert.equal(poor.currentBet, 10);
});

test("straddle off by default leaves the hand unchanged", () => {
  const st = hand({ straddle: false });
  assert.equal(st.initialEvents.find((e) => e.type === "blindsPosted").straddle, null);
  assert.equal(st.currentBet, 10);
  assert.equal(st.toActSeat, 1, "UTG (button, 3-handed) acts first with no straddle");
});
