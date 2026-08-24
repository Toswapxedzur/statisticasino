// The generic flop-poker engine. Despite the filename, this drives EVERY
// Hold'em-family variant (Hold'em, Omaha, Short Deck, …) — the parts that differ
// between games live in the variant descriptor (see variants.js) and are read in
// through getVariant(state.variantKey). The betting state machine here is
// variant-independent.
import { getVariant } from "./variants.js";

const BETTING_STREETS = new Set(["preflop", "flop", "turn", "river"]);
const ACTION_TYPES = new Set(["fold", "check", "call", "bet", "raise", "allin"]);

function variantOf(state) {
  return getVariant(state.variantKey);
}

function assertInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
}

function assertDeck(deck, variant) {
  const cards = variant.deck();
  if (!Array.isArray(deck) || deck.length !== cards.length) {
    throw new TypeError(`deck must be a full ${cards.length}-card array`);
  }
  const expected = new Set(cards);
  const actual = new Set(deck);
  if (actual.size !== cards.length || [...actual].some((card) => !expected.has(card))) {
    throw new RangeError("deck must contain every card for the variant exactly once");
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function orderedPlayers(stateOrPlayers) {
  const players = Array.isArray(stateOrPlayers) ? stateOrPlayers : stateOrPlayers.players;
  return [...players].sort((a, b) => a.seat - b.seat);
}

// The first matching player strictly clockwise (left) of `seat`.
function nextClockwise(players, seat, predicate = () => true) {
  const ordered = orderedPlayers(players);
  const after = ordered.filter((player) => player.seat > seat);
  return [...after, ...ordered.filter((player) => player.seat <= seat)].find(predicate) ?? null;
}

function clockwiseFromButton(state) {
  const ordered = orderedPlayers(state);
  return [
    ...ordered.filter((player) => player.seat > state.buttonSeat),
    ...ordered.filter((player) => player.seat <= state.buttonSeat)
  ];
}

function takeCards(state, count) {
  const end = state.deckPosition + count;
  if (end > state.deck.length) throw new RangeError("deck ran out of cards");
  const cards = state.deck.slice(state.deckPosition, end);
  state.deckPosition = end;
  return cards;
}

function contribute(player, amount, countsThisStreet = true) {
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  if (countsThisStreet) player.committedThisStreet += paid;
  player.totalCommitted += paid;
  if (player.stack === 0) player.status = "allin";
  return paid;
}

// Build one layer for every distinct contribution cap. A one-player side
// pot is retained deliberately: it is the deterministic representation of
// unmatched all-in chips and is paid back to that sole eligible player.
function buildPots(players) {
  const levels = [...new Set(players.map((player) => player.totalCommitted).filter(Boolean))]
    .sort((a, b) => a - b);
  const pots = [];
  let previous = 0;

  for (const level of levels) {
    const contributors = players.filter((player) => player.totalCommitted >= level);
    const amount = (level - previous) * contributors.length;
    const eligibleSeats = contributors
      .filter((player) => player.status !== "folded")
      .map((player) => player.seat)
      .sort((a, b) => a - b);
    if (amount > 0) pots.push({ amount, eligibleSeats });
    previous = level;
  }

  return pots;
}

function activePlayers(state) {
  return state.players.filter((player) => player.status === "active");
}

function nonFoldedPlayers(state) {
  return state.players.filter((player) => player.status !== "folded");
}

function needsAction(player, state) {
  return player.status === "active" &&
    (!player.hasActedThisRound || player.committedThisStreet < state.currentBet);
}

function bettingRoundClosed(state) {
  const active = activePlayers(state);
  if (active.length === 0) return true;
  if (active.length === 1) {
    return active[0].committedThisStreet >= state.currentBet;
  }
  return active.every(
    (player) => player.hasActedThisRound && player.committedThisStreet === state.currentBet
  );
}

function setNextActor(state, afterSeat) {
  const next = nextClockwise(state.players, afterSeat, (player) => needsAction(player, state));
  if (!next) throw new Error("betting round is open but no player needs action");
  state.toActSeat = next.seat;
}

function dealStreet(state, street, events) {
  const scheduled = variantOf(state).boardSchedule.find((entry) => entry.street === street);
  const count = scheduled ? scheduled.deal : 1;
  const cards = takeCards(state, count);
  state.board.push(...cards);
  state.street = street;
  events.push({ type: "streetDealt", street, cards: [...cards] });
}

function resetBettingRound(state) {
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.lastAggressorSeat = null;
  for (const player of state.players) {
    player.committedThisStreet = 0;
    player.hasActedThisRound = player.status !== "active";
    player.canRaise = player.status === "active";
  }
  const first = nextClockwise(state.players, state.buttonSeat, (player) => player.status === "active");
  state.toActSeat = first?.seat ?? null;
}

function nextStreet(variant, street) {
  const index = variant.streets.indexOf(street);
  return index >= 0 && index + 1 < variant.streets.length ? variant.streets[index + 1] : null;
}

function runOutBoard(state, events) {
  const variant = variantOf(state);
  const lastStreet = variant.streets[variant.streets.length - 1];
  let street = state.street;
  while (street !== lastStreet) {
    const upcoming = nextStreet(variant, street);
    if (!upcoming) break;
    dealStreet(state, upcoming, events);
    street = upcoming;
  }
  state.toActSeat = null;
}

function settleShowdown(state, events) {
  const variant = variantOf(state);
  state.street = "showdown";
  state.toActSeat = null;
  state.pots = buildPots(state.players);

  const hands = nonFoldedPlayers(state)
    .map((player) => ({
      seat: player.seat,
      holeCards: [...player.holeCards],
      ...variant.evaluate(player.holeCards, state.board)
    }))
    .sort((a, b) => a.seat - b.seat);
  const handBySeat = new Map(hands.map((hand) => [hand.seat, hand]));
  const payoutBySeat = new Map();
  const resultPots = [];

  // Split `amount` among the winners; odd chips go clockwise from the button.
  const distribute = (amount, winnerSeats) => {
    if (!winnerSeats.length || amount <= 0) return;
    const share = Math.floor(amount / winnerSeats.length);
    let oddChips = amount % winnerSeats.length;
    for (const seat of winnerSeats) payoutBySeat.set(seat, (payoutBySeat.get(seat) ?? 0) + share);
    for (const player of clockwiseFromButton(state)) {
      if (oddChips === 0) break;
      if (winnerSeats.includes(player.seat)) { payoutBySeat.set(player.seat, payoutBySeat.get(player.seat) + 1); oddChips -= 1; }
    }
  };
  // The seats tied for best among `seats`, by `cmp` (wantLower flips it for lows).
  const bestSeats = (seats, rankOf, cmp, wantLower) => {
    let best = rankOf(seats[0]);
    for (const seat of seats.slice(1)) {
      const cand = rankOf(seat);
      if (wantLower ? cmp(cand, best) < 0 : cmp(cand, best) > 0) best = cand;
    }
    return seats.filter((seat) => cmp(rankOf(seat), best) === 0);
  };

  // Hi-lo: precompute each showdown hand's best qualifying low (null if none).
  const lowBySeat = new Map();
  if (variant.evaluateLow) {
    for (const hand of hands) {
      const low = variant.evaluateLow(hand.holeCards, state.board);
      if (low) lowBySeat.set(hand.seat, low);
    }
  }

  for (const [potIndex, pot] of state.pots.entries()) {
    const eligible = pot.eligibleSeats.filter((seat) => handBySeat.has(seat));
    if (eligible.length === 0) throw new Error(`pot ${potIndex} has no eligible player`);

    const highWinners = bestSeats(eligible, (seat) => handBySeat.get(seat), variant.compare, false);
    const lowSeats = variant.evaluateLow ? eligible.filter((seat) => lowBySeat.has(seat)) : [];
    let lowWinners = [];
    if (lowSeats.length) {
      lowWinners = bestSeats(lowSeats, (seat) => lowBySeat.get(seat), variant.compareLow, true);
      distribute(Math.ceil(pot.amount / 2), highWinners); // odd chip to the high hand
      distribute(Math.floor(pot.amount / 2), lowWinners);
    } else {
      distribute(pot.amount, highWinners); // no qualifying low → high scoops
    }
    resultPots.push({ amount: pot.amount, eligibleSeats: [...eligible], winnerSeats: [...highWinners], lowWinnerSeats: [...lowWinners] });
  }

  events.push({ type: "showdown", board: [...state.board], hands: clone(hands) });
  state.payouts = [...payoutBySeat.entries()]
    .map(([seat, amount]) => ({ seat, amount }))
    .sort((a, b) => a.seat - b.seat);
  for (const payout of state.payouts) {
    const player = state.players.find((candidate) => candidate.seat === payout.seat);
    player.stack += payout.amount;
    events.push({ type: "payout", seat: payout.seat, amount: payout.amount });
  }

  state.result = {
    type: "showdown",
    board: [...state.board],
    hands: clone(hands),
    pots: resultPots
  };
  state.street = "complete";
  events.push({ type: "handComplete", result: clone(state.result) });
}

function completeUncontested(state, events) {
  const winner = nonFoldedPlayers(state)[0];
  const highestOtherContribution = Math.max(
    0,
    ...state.players.filter((player) => player.seat !== winner.seat)
      .map((player) => player.totalCommitted)
  );
  const uncalled = Math.max(0, winner.totalCommitted - highestOtherContribution);

  if (uncalled > 0) {
    winner.totalCommitted -= uncalled;
    winner.committedThisStreet = Math.max(0, winner.committedThisStreet - uncalled);
    winner.stack += uncalled;
    if (winner.status === "allin") winner.status = "active";
    events.push({ type: "uncalledBetReturned", seat: winner.seat, amount: uncalled });
  }

  const amount = state.players.reduce((sum, player) => sum + player.totalCommitted, 0);
  state.pots = amount > 0 ? [{ amount, eligibleSeats: [winner.seat] }] : [];
  state.payouts = amount > 0 ? [{ seat: winner.seat, amount }] : [];
  winner.stack += amount;
  state.toActSeat = null;
  state.result = {
    type: "uncontested",
    winnerSeat: winner.seat,
    amount,
    revealedHoleCards: false
  };
  state.street = "complete";
  if (amount > 0) events.push({ type: "payout", seat: winner.seat, amount });
  events.push({ type: "handComplete", result: clone(state.result) });
}

function finishTransition(state, events, afterSeat) {
  const variant = variantOf(state);
  const lastStreet = variant.streets[variant.streets.length - 1];
  state.pots = buildPots(state.players);

  if (nonFoldedPlayers(state).length === 1) {
    completeUncontested(state, events);
    return;
  }

  if (!bettingRoundClosed(state)) {
    setNextActor(state, afterSeat);
    return;
  }

  if (state.street === lastStreet) {
    settleShowdown(state, events);
    return;
  }

  if (activePlayers(state).length <= 1) {
    runOutBoard(state, events);
    settleShowdown(state, events);
    return;
  }

  dealStreet(state, nextStreet(variant, state.street), events);
  resetBettingRound(state);
}

/**
 * Create a deterministic Hold'em hand. The first deck element is the top;
 * hole cards are dealt one at a time clockwise from the button's left.
 */
export function createHand(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("config must be an object");
  }
  if (!Array.isArray(config.players) || config.players.length < 2 || config.players.length > 10) {
    throw new RangeError("players must contain between 2 and 10 entries");
  }
  assertInteger(config.buttonSeat, "buttonSeat");
  assertInteger(config.smallBlind, "smallBlind", 1);
  assertInteger(config.bigBlind, "bigBlind", 1);
  if (config.bigBlind < config.smallBlind) {
    throw new RangeError("bigBlind must be at least smallBlind");
  }
  const ante = config.ante ?? 0;
  assertInteger(ante, "ante");
  const variantKey = config.variant || "holdem";
  const variant = getVariant(variantKey);
  assertDeck(config.deck, variant);

  const seats = new Set();
  const ids = new Set();
  for (const player of config.players) {
    if (!player || typeof player !== "object") throw new TypeError("each player must be an object");
    assertInteger(player.seat, "player.seat");
    assertInteger(player.stack, "player.stack", 1);
    if ((typeof player.id !== "string" && typeof player.id !== "number") || player.id === "") {
      throw new TypeError("player.id must be a non-empty string or number");
    }
    if (seats.has(player.seat)) throw new RangeError(`duplicate seat: ${player.seat}`);
    if (ids.has(player.id)) throw new RangeError(`duplicate player id: ${String(player.id)}`);
    seats.add(player.seat);
    ids.add(player.id);
  }
  if (!seats.has(config.buttonSeat)) throw new RangeError("buttonSeat must be occupied");

  const state = {
    street: "preflop",
    variantKey,
    board: [],
    buttonSeat: config.buttonSeat,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante,
    players: orderedPlayers(config.players).map((player) => ({
      seat: player.seat,
      id: player.id,
      holeCards: [],
      stack: player.stack,
      committedThisStreet: 0,
      totalCommitted: 0,
      status: "active",
      hasActedThisRound: false,
      canRaise: true
    })),
    toActSeat: null,
    currentBet: config.bigBlind,
    minRaise: config.bigBlind,
    lastAggressorSeat: null,
    pots: [],
    payouts: [],
    result: null,
    deck: [...config.deck],
    deckPosition: 0,
    initialEvents: []
  };

  const antePosts = [];
  for (const player of state.players) {
    const amount = contribute(player, ante, false);
    if (ante > 0) antePosts.push({ seat: player.seat, amount });
  }

  let smallBlindPlayer;
  let bigBlindPlayer;
  if (state.players.length === 2) {
    smallBlindPlayer = state.players.find((player) => player.seat === state.buttonSeat);
    bigBlindPlayer = nextClockwise(state.players, state.buttonSeat);
  } else {
    smallBlindPlayer = nextClockwise(state.players, state.buttonSeat);
    bigBlindPlayer = nextClockwise(state.players, smallBlindPlayer.seat);
  }
  const smallBlindPosted = contribute(smallBlindPlayer, state.smallBlind);
  const bigBlindPosted = contribute(bigBlindPlayer, state.bigBlind);

  state.initialEvents.push({
    type: "blindsPosted",
    antes: antePosts,
    smallBlind: { seat: smallBlindPlayer.seat, amount: smallBlindPosted },
    bigBlind: { seat: bigBlindPlayer.seat, amount: bigBlindPosted }
  });

  const dealOrder = [];
  let cursor = state.buttonSeat;
  for (let i = 0; i < state.players.length; i += 1) {
    const player = nextClockwise(state.players, cursor);
    dealOrder.push(player);
    cursor = player.seat;
  }
  for (let pass = 0; pass < variant.holeCount; pass += 1) {
    for (const player of dealOrder) player.holeCards.push(takeCards(state, 1)[0]);
  }
  state.initialEvents.push({
    type: "holeCardsDealt",
    hands: state.players.map((player) => ({ seat: player.seat, cards: [...player.holeCards] }))
  });

  for (const player of state.players) {
    player.hasActedThisRound = player.status !== "active";
    player.canRaise = player.status === "active";
  }
  state.pots = buildPots(state.players);

  const first = nextClockwise(state.players, bigBlindPlayer.seat, (player) => player.status === "active");
  state.toActSeat = first?.seat ?? null;
  if (bettingRoundClosed(state)) {
    const setupEvents = [];
    finishTransition(state, setupEvents, bigBlindPlayer.seat);
    state.initialEvents.push(...setupEvents);
  }

  return state;
}

/** Return the exact action menu for the current actor. */
export function legalActions(state) {
  if (
    !state ||
    !BETTING_STREETS.has(state.street) ||
    state.toActSeat === null
  ) {
    return { toActSeat: null, actions: [] };
  }

  const player = state.players.find((candidate) => candidate.seat === state.toActSeat);
  if (!player || player.status !== "active") return { toActSeat: null, actions: [] };

  const actions = [{ type: "fold" }];
  const callAmount = Math.min(player.stack, Math.max(0, state.currentBet - player.committedThisStreet));
  if (callAmount === 0) actions.push({ type: "check" });
  else actions.push({ type: "call", amount: callAmount });

  // Chips cannot be bet into a field containing no other player who can act.
  const canAggress = activePlayers(state).length >= 2;
  const allInCap = player.committedThisStreet + player.stack; // most this seat can commit
  const structure = variantOf(state).bettingStructure;

  // Largest legal bet/raise target for this street under the structure. Pot-limit
  // caps a raise at a pot-sized raise (call, then raise the resulting pot);
  // no-limit is capped only by the stack.
  let maxTarget = allInCap;
  if (structure === "pot-limit") {
    const pot = state.players.reduce((sum, other) => sum + other.totalCommitted, 0);
    const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
    maxTarget = Math.min(allInCap, state.currentBet + pot + toCall);
  }

  if (canAggress && player.canRaise) {
    if (state.currentBet === 0 && maxTarget >= state.minRaise) {
      actions.push({ type: "bet", min: state.minRaise, max: maxTarget });
    } else if (state.currentBet > 0 && maxTarget >= state.currentBet + state.minRaise) {
      actions.push({ type: "raise", min: state.currentBet + state.minRaise, max: maxTarget });
    }
  }

  // All-in is always legal as a call/complete for less; as a RAISE it needs
  // aggression rights, and under pot-limit must not exceed the pot cap.
  const allInRaises = allInCap > state.currentBet;
  let allowAllIn;
  if (!allInRaises) {
    allowAllIn = player.stack > 0;
  } else {
    const withinCap = structure === "pot-limit" ? allInCap <= maxTarget : true;
    allowAllIn = player.stack > 0 && canAggress && player.canRaise && withinCap;
  }
  if (allowAllIn) actions.push({ type: "allin", amount: player.stack });

  return { toActSeat: player.seat, actions };
}

/** Apply one legal action without mutating the input state. */
export function applyAction(state, action) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("state must be a HandState object");
  }
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new TypeError("action must be an object");
  }
  if (!ACTION_TYPES.has(action.type)) throw new RangeError(`unknown action type: ${String(action.type)}`);
  if (!BETTING_STREETS.has(state.street) || state.toActSeat === null) {
    throw new Error("the hand is not waiting for an action");
  }
  if (action.seat !== state.toActSeat) throw new Error(`it is seat ${state.toActSeat}'s turn`);

  const menu = legalActions(state);
  const option = menu.actions.find((candidate) => candidate.type === action.type);
  if (!option) throw new Error(`${action.type} is not legal for seat ${action.seat}`);

  const next = clone(state);
  const player = next.players.find((candidate) => candidate.seat === action.seat);
  const events = [];
  let contributed = 0;
  let fullRaise = false;
  let aggressive = false;
  let target = player.committedThisStreet;

  if (action.type === "fold" || action.type === "check") {
    if (action.amount !== undefined) throw new RangeError(`${action.type} does not take an amount`);
    if (action.type === "fold") player.status = "folded";
  } else if (action.type === "call") {
    if (action.amount !== undefined && action.amount !== option.amount) {
      throw new RangeError(`call amount must be exactly ${option.amount}`);
    }
    contributed = contribute(player, option.amount);
    target = player.committedThisStreet;
  } else if (action.type === "bet" || action.type === "raise") {
    if (!Number.isSafeInteger(action.amount)) throw new TypeError(`${action.type} amount must be an integer`);
    if (action.amount < option.min || action.amount > option.max) {
      throw new RangeError(`${action.type} target must be between ${option.min} and ${option.max}`);
    }
    target = action.amount;
    contributed = contribute(player, target - player.committedThisStreet);
    aggressive = true;
    fullRaise = true;
  } else {
    if (action.amount !== undefined && action.amount !== option.amount) {
      throw new RangeError(`allin amount must be exactly ${option.amount}`);
    }
    target = player.committedThisStreet + player.stack;
    contributed = contribute(player, player.stack);
    if (target > next.currentBet) {
      aggressive = true;
      fullRaise = target - next.currentBet >= next.minRaise;
    }
  }

  player.hasActedThisRound = true;
  player.canRaise = false;

  if (aggressive) {
    const raiseSize = target - next.currentBet;
    next.currentBet = target;
    next.lastAggressorSeat = player.seat;
    if (fullRaise) {
      next.minRaise = raiseSize;
      for (const other of next.players) {
        if (other.seat !== player.seat && other.status === "active") {
          other.hasActedThisRound = false;
          other.canRaise = true;
        }
      }
    }
  }

  const eventAction = { type: action.type };
  if (action.type === "bet" || action.type === "raise") eventAction.amount = target;
  if (action.type === "call" || action.type === "allin") eventAction.amount = contributed;
  events.push({
    type: "action",
    seat: player.seat,
    action: eventAction,
    contributed,
    allIn: player.status === "allin"
  });

  finishTransition(next, events, player.seat);
  return { state: next, events };
}
