import test from "node:test";
import assert from "node:assert/strict";

import { standardDeck } from "./cards.js";
import { applyAction, createHand, legalActions } from "./holdem.js";

function riggedDeck(firstCards = []) {
  assert.equal(new Set(firstCards).size, firstCards.length, "rigged cards must be unique");
  const used = new Set(firstCards);
  return [...firstCards, ...standardDeck().filter((card) => !used.has(card))];
}

function makeHand({ stacks = [100, 100, 100], buttonSeat = 1, smallBlind = 5, bigBlind = 10,
  ante = 0, deck = standardDeck() } = {}) {
  return createHand({
    players: stacks.map((stack, index) => ({ id: `p${index + 1}`, seat: index + 1, stack })),
    buttonSeat,
    smallBlind,
    bigBlind,
    ante,
    deck
  });
}

function act(state, action) {
  return applyAction(state, action).state;
}

function checkDown(state) {
  let current = state;
  const events = [];
  while (current.street !== "complete") {
    const menu = legalActions(current);
    const option = menu.actions.find((action) => action.type === "check") ??
      menu.actions.find((action) => action.type === "call");
    assert.ok(option, `seat ${menu.toActSeat} must be able to check or call`);
    const result = applyAction(current, { seat: menu.toActSeat, type: option.type });
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

test("blinds, preflop order, limped-BB option, and postflop order are correct", () => {
  let state = makeHand();
  const [button, smallBlind, bigBlind] = state.players;

  assert.equal(button.committedThisStreet, 0);
  assert.equal(smallBlind.committedThisStreet, 5);
  assert.equal(bigBlind.committedThisStreet, 10);
  assert.equal(state.currentBet, 10);
  assert.equal(state.minRaise, 10);
  assert.equal(state.toActSeat, 1, "first preflop actor is left of the BB");

  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "call" });
  assert.equal(state.toActSeat, 3, "the BB keeps an option after limps");
  assert.ok(legalActions(state).actions.some((action) => action.type === "check"));

  state = act(state, { seat: 3, type: "check" });
  assert.equal(state.street, "flop");
  assert.equal(state.toActSeat, 2, "postflop action begins left of the button");
  assert.equal(state.currentBet, 0);
  assert.equal(state.players.every((player) => player.committedThisStreet === 0), true);
});

test("heads-up button posts the small blind and acts first preflop; BB acts first later", () => {
  let state = makeHand({ stacks: [100, 100] });
  assert.equal(state.players[0].committedThisStreet, 5);
  assert.equal(state.players[1].committedThisStreet, 10);
  assert.equal(state.toActSeat, 1);

  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "check" });
  assert.equal(state.street, "flop");
  assert.equal(state.toActSeat, 2);
});

test("minimum raise is the last full raise size and bad targets throw", () => {
  let state = makeHand();
  assert.deepEqual(
    legalActions(state).actions.find((action) => action.type === "raise"),
    { type: "raise", min: 20, max: 100 }
  );

  state = act(state, { seat: 1, type: "raise", amount: 25 });
  assert.equal(state.currentBet, 25);
  assert.equal(state.minRaise, 15);
  assert.throws(() => applyAction(state, { seat: 2, type: "raise", amount: 39 }), /between 40 and 100/);
  state = act(state, { seat: 2, type: "raise", amount: 40 });
  assert.equal(state.minRaise, 15);
});

test("an incomplete all-in raise does not reopen players who already acted", () => {
  let state = makeHand({ stacks: [100, 25, 100, 100] });
  state = act(state, { seat: 4, type: "raise", amount: 20 });
  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "allin" });
  assert.equal(state.currentBet, 25);
  assert.equal(state.minRaise, 10);

  state = act(state, { seat: 3, type: "call" });
  assert.equal(state.toActSeat, 4);
  const types = legalActions(state).actions.map((action) => action.type);
  assert.deepEqual(types, ["fold", "call"]);
  assert.throws(() => applyAction(state, { seat: 4, type: "raise", amount: 35 }), /not legal/);
});

test("a subsequent full raise reopens betting for prior actors", () => {
  let state = makeHand({ stacks: [100, 25, 100, 100] });
  state = act(state, { seat: 4, type: "raise", amount: 20 });
  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "allin" });
  state = act(state, { seat: 3, type: "raise", amount: 35 });

  assert.equal(state.toActSeat, 4);
  assert.deepEqual(
    legalActions(state).actions.find((action) => action.type === "raise"),
    { type: "raise", min: 45, max: 100 }
  );
});

test("a call is capped at the caller's remaining stack", () => {
  const state = makeHand({ stacks: [7, 100] });
  assert.deepEqual(
    legalActions(state).actions.find((action) => action.type === "call"),
    { type: "call", amount: 2 }
  );
  const result = applyAction(state, { seat: 1, type: "call", amount: 2 });
  assert.equal(result.events[0].contributed, 2);
  assert.equal(result.state.players[0].status, "allin");
  assert.equal(result.state.street, "complete");
});

test("three distinct all-in stacks create a main pot and two side pots", () => {
  let state = makeHand({ stacks: [100, 30, 60] });
  state = act(state, { seat: 1, type: "allin" });
  state = act(state, { seat: 2, type: "call" });
  state = act(state, { seat: 3, type: "call" });

  assert.equal(state.street, "complete");
  assert.deepEqual(state.pots, [
    { amount: 90, eligibleSeats: [1, 2, 3] },
    { amount: 60, eligibleSeats: [1, 3] },
    { amount: 40, eligibleSeats: [1] }
  ]);
});

test("split pots award the odd chip clockwise from the button's left", () => {
  const deck = riggedDeck([
    "2c", "3d", "4h", "5s", "6c", "7d",
    "Ah", "Kd", "Qc", "Js", "Th"
  ]);
  let state = makeHand({ smallBlind: 1, bigBlind: 2, deck });
  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "fold" });
  state = act(state, { seat: 3, type: "check" });
  state = checkDown(state).state;

  assert.deepEqual(state.payouts, [
    { seat: 1, amount: 2 },
    { seat: 3, amount: 3 }
  ]);
  assert.deepEqual(state.result.pots[0].winnerSeats, [1, 3]);
});

test("a folded player never wins even when their cards would be strongest", () => {
  const deck = riggedDeck([
    "Ah", "Kc", "Qc", "Ad", "Kd", "Qd",
    "As", "Ac", "2h", "3h", "4h"
  ]);
  let state = makeHand({ smallBlind: 1, bigBlind: 2, deck });
  state = act(state, { seat: 1, type: "call" });
  state = act(state, { seat: 2, type: "fold" });
  state = act(state, { seat: 3, type: "check" });
  state = checkDown(state).state;

  assert.equal(state.result.hands.some((hand) => hand.seat === 2), false);
  assert.equal(state.payouts.some((payout) => payout.seat === 2), false);
  assert.deepEqual(state.result.pots[0].winnerSeats, [3]);
});

test("folds to a raise return the uncalled portion and complete without revealing cards", () => {
  let state = makeHand();
  state = act(state, { seat: 1, type: "raise", amount: 40 });
  state = act(state, { seat: 2, type: "fold" });
  const result = applyAction(state, { seat: 3, type: "fold" });
  state = result.state;

  assert.equal(state.street, "complete");
  assert.deepEqual(state.pots, [{ amount: 25, eligibleSeats: [1] }]);
  assert.deepEqual(state.payouts, [{ seat: 1, amount: 25 }]);
  assert.equal(state.players[0].stack, 115);
  assert.deepEqual(state.result, {
    type: "uncontested",
    winnerSeat: 1,
    amount: 25,
    revealedHoleCards: false
  });
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["action", "uncalledBetReturned", "payout", "handComplete"]
  );
  assert.equal(JSON.stringify(state.result).includes("holeCards"), false);
});

test("preflop all-ins automatically deal all streets and go to showdown", () => {
  const deck = riggedDeck(["As", "Kh", "Ad", "Kd", "2c", "3d", "4h", "5s", "9c"]);
  const state = makeHand({ stacks: [10, 10], deck });
  const result = applyAction(state, { seat: 1, type: "allin" });

  assert.equal(result.state.street, "complete");
  assert.deepEqual(result.state.board, ["2c", "3d", "4h", "5s", "9c"]);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["action", "streetDealt", "streetDealt", "streetDealt", "showdown", "payout", "handComplete"]
  );
  assert.equal(legalActions(result.state).toActSeat, null);
});

test("partial all-in blinds are posted exactly while the full BB remains the bring-in", () => {
  let state = makeHand({ stacks: [100, 3, 7] });
  assert.deepEqual(state.initialEvents[0].smallBlind, { seat: 2, amount: 3 });
  assert.deepEqual(state.initialEvents[0].bigBlind, { seat: 3, amount: 7 });
  assert.equal(state.players[1].status, "allin");
  assert.equal(state.players[2].status, "allin");
  assert.equal(state.currentBet, 10);
  assert.equal(state.minRaise, 10);
  assert.deepEqual(
    legalActions(state).actions.find((action) => action.type === "call"),
    { type: "call", amount: 10 }
  );

  state = act(state, { seat: 1, type: "call" });
  assert.equal(state.street, "complete");
  assert.equal(state.board.length, 5);
});

test("antes are forced all-ins when necessary and do not count as street bets", () => {
  const state = makeHand({ stacks: [100, 4, 100], ante: 4 });
  assert.equal(state.players[1].totalCommitted, 4);
  assert.equal(state.players[1].committedThisStreet, 0);
  assert.equal(state.players[1].status, "allin");
  assert.deepEqual(state.initialEvents[0].antes, [
    { seat: 1, amount: 4 },
    { seat: 2, amount: 4 },
    { seat: 3, amount: 4 }
  ]);
});

test("applyAction is pure and rejects wrong turns, types, and amounts", () => {
  const state = makeHand();
  const before = structuredClone(state);
  applyAction(state, { seat: 1, type: "call" });
  assert.deepEqual(state, before);

  assert.throws(() => applyAction(state, { seat: 2, type: "call" }), /seat 1's turn/);
  assert.throws(() => applyAction(state, { seat: 1, type: "check" }), /not legal/);
  assert.throws(() => applyAction(state, { seat: 1, type: "raise", amount: 19 }), /between 20 and 100/);
  assert.throws(() => applyAction(state, { seat: 1, type: "dance" }), /unknown action/);
});

test("input validation rejects duplicate cards, seats, and missing button seats", () => {
  const deck = standardDeck();
  deck[51] = deck[0];
  assert.throws(() => makeHand({ deck }), /every standard card exactly once/);
  assert.throws(
    () => createHand({
      players: [{ id: "a", seat: 1, stack: 10 }, { id: "b", seat: 1, stack: 10 }],
      buttonSeat: 1,
      smallBlind: 1,
      bigBlind: 2,
      deck: standardDeck()
    }),
    /duplicate seat/
  );
  assert.throws(() => makeHand({ buttonSeat: 9 }), /buttonSeat must be occupied/);
});
