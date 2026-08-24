// Shared betting engine for the NON-flop poker games (Five-Card Draw, Seven-Card
// Stud). It is the same battle-tested betting logic the flop engine uses — call /
// raise / all-in with pot-/no-limit caps, side pots, and hi(/lo) showdown award —
// but factored out to be STREET-AGNOSTIC: it knows nothing about boards, draws,
// blinds, or bring-ins. The per-game engines own dealing + street progression and
// drive one betting round at a time through here. holdem.js is deliberately left
// untouched so live Hold'em/Omaha is unaffected.

export function orderedPlayers(players) {
  return [...players].sort((a, b) => a.seat - b.seat);
}

// First matching player strictly clockwise (higher seat, wrapping) of `seat`.
export function nextClockwise(players, seat, predicate = () => true) {
  const ordered = orderedPlayers(players);
  const after = ordered.filter((p) => p.seat > seat);
  return [...after, ...ordered.filter((p) => p.seat <= seat)].find(predicate) ?? null;
}

export function clockwiseFrom(players, seat) {
  const ordered = orderedPlayers(players);
  return [...ordered.filter((p) => p.seat > seat), ...ordered.filter((p) => p.seat <= seat)];
}

export function contribute(player, amount, countsThisStreet = true) {
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  if (countsThisStreet) player.committedThisStreet += paid;
  player.totalCommitted += paid;
  if (player.stack === 0) player.status = "allin";
  return paid;
}

export function buildPots(players) {
  const levels = [...new Set(players.map((p) => p.totalCommitted).filter(Boolean))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((p) => p.totalCommitted >= level);
    const amount = (level - previous) * contributors.length;
    const eligibleSeats = contributors.filter((p) => p.status !== "folded").map((p) => p.seat).sort((a, b) => a - b);
    if (amount > 0) pots.push({ amount, eligibleSeats });
    previous = level;
  }
  return pots;
}

export const activePlayers = (state) => state.players.filter((p) => p.status === "active");
export const nonFolded = (state) => state.players.filter((p) => p.status !== "folded");

function needsAction(player, state) {
  return player.status === "active" && (!player.hasActedThisRound || player.committedThisStreet < state.currentBet);
}

export function bettingRoundClosed(state) {
  const active = activePlayers(state);
  if (active.length === 0) return true;
  if (active.length === 1) return active[0].committedThisStreet >= state.currentBet;
  return active.every((p) => p.hasActedThisRound && p.committedThisStreet === state.currentBet);
}

function setNextActor(state, afterSeat) {
  const next = nextClockwise(state.players, afterSeat, (p) => needsAction(p, state));
  state.toActSeat = next ? next.seat : null;
}

// Open a fresh betting round: `firstSeat` is chosen by the driver (clockwise from
// the button for draw; the bring-in / high board for stud). Pass a starting
// `currentBet` (>0) only when forced bets have already been posted this street.
export function openBettingRound(state, firstSeat, { currentBet = 0, minRaise = state.minBet } = {}) {
  state.currentBet = currentBet;
  state.minRaise = minRaise;
  state.lastAggressorSeat = null;
  for (const player of state.players) {
    if (currentBet === 0) player.committedThisStreet = 0;
    player.hasActedThisRound = player.status !== "active";
    player.canRaise = player.status === "active";
  }
  state.toActSeat = firstSeat;
}

// The legal betting menu for the current actor. Street-agnostic.
export function bettingActions(state) {
  if (!state || state.toActSeat === null) return { toActSeat: null, actions: [] };
  const player = state.players.find((p) => p.seat === state.toActSeat);
  if (!player || player.status !== "active") return { toActSeat: null, actions: [] };

  const actions = [{ type: "fold" }];
  const callAmount = Math.min(player.stack, Math.max(0, state.currentBet - player.committedThisStreet));
  if (callAmount === 0) actions.push({ type: "check" });
  else actions.push({ type: "call", amount: callAmount });

  const canAggress = activePlayers(state).length >= 2;
  const allInCap = player.committedThisStreet + player.stack;
  const structure = state.bettingStructure;

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

  const allInRaises = allInCap > state.currentBet;
  let allowAllIn;
  if (!allInRaises) allowAllIn = player.stack > 0;
  else {
    const withinCap = structure === "pot-limit" ? allInCap <= maxTarget : true;
    allowAllIn = player.stack > 0 && canAggress && player.canRaise && withinCap;
  }
  if (allowAllIn) actions.push({ type: "allin", amount: player.stack });

  return { toActSeat: player.seat, actions };
}

// Apply one betting action IN PLACE (the driver clones first). Advances the actor
// when the round stays open. Returns { events, closed }. Does NOT progress streets
// or settle — that's the driver's job (it also handles the sole-survivor case).
export function applyBettingAction(state, action) {
  const menu = bettingActions(state);
  if (action.seat !== state.toActSeat) throw new Error(`it is seat ${state.toActSeat}'s turn`);
  const option = menu.actions.find((a) => a.type === action.type);
  if (!option) throw new Error(`${action.type} is not legal for seat ${action.seat}`);

  const player = state.players.find((p) => p.seat === action.seat);
  const events = [];
  let contributed = 0;
  let aggressive = false;
  let fullRaise = false;
  let target = player.committedThisStreet;

  if (action.type === "fold") player.status = "folded";
  else if (action.type === "check") { /* no chips */ }
  else if (action.type === "call") { contributed = contribute(player, option.amount); target = player.committedThisStreet; }
  else if (action.type === "bet" || action.type === "raise") {
    if (!Number.isSafeInteger(action.amount) || action.amount < option.min || action.amount > option.max) {
      throw new RangeError(`${action.type} target must be between ${option.min} and ${option.max}`);
    }
    target = action.amount;
    contributed = contribute(player, target - player.committedThisStreet);
    aggressive = true;
    fullRaise = true;
  } else { // allin
    target = player.committedThisStreet + player.stack;
    contributed = contribute(player, player.stack);
    if (target > state.currentBet) { aggressive = true; fullRaise = target - state.currentBet >= state.minRaise; }
  }

  player.hasActedThisRound = true;
  player.canRaise = false;

  if (aggressive) {
    const raiseSize = target - state.currentBet;
    state.currentBet = target;
    state.lastAggressorSeat = player.seat;
    if (fullRaise) {
      state.minRaise = raiseSize;
      for (const other of state.players) {
        if (other.seat !== player.seat && other.status === "active") { other.hasActedThisRound = false; other.canRaise = true; }
      }
    }
  }

  const eventAction = { type: action.type };
  if (action.type === "bet" || action.type === "raise") eventAction.amount = target;
  if (action.type === "call" || action.type === "allin") eventAction.amount = contributed;
  events.push({ type: "action", seat: player.seat, action: eventAction, contributed, allIn: player.status === "allin" });

  const closed = bettingRoundClosed(state);
  if (!closed) setNextActor(state, player.seat);
  else state.toActSeat = null;
  return { events, closed };
}

// Showdown award over the built side pots. `evaluate(player) -> rank` and
// `compare(a,b)` are the game's high evaluator; optional `evaluateLow(player) ->
// low|null` + `compareLow` add a hi-lo split. Mutates state (pots, payouts,
// stacks, result) and pushes events. Mirrors holdem.js's settleShowdown.
export function settlePots(state, { evaluate, compare, evaluateLow = null, compareLow = null }, events) {
  state.pots = buildPots(state.players);
  const hands = nonFolded(state)
    .map((p) => ({ seat: p.seat, holeCards: [...(p.holeCards || [])], ...evaluate(p) }))
    .sort((a, b) => a.seat - b.seat);
  const handBySeat = new Map(hands.map((h) => [h.seat, h]));
  const payoutBySeat = new Map();
  const resultPots = [];

  const distribute = (amount, winners) => {
    if (!winners.length || amount <= 0) return;
    const share = Math.floor(amount / winners.length);
    let odd = amount % winners.length;
    for (const seat of winners) payoutBySeat.set(seat, (payoutBySeat.get(seat) ?? 0) + share);
    for (const p of clockwiseFrom(state.players, state.buttonSeat)) {
      if (odd === 0) break;
      if (winners.includes(p.seat)) { payoutBySeat.set(p.seat, payoutBySeat.get(p.seat) + 1); odd -= 1; }
    }
  };
  const bestSeats = (seats, rankOf, cmp, wantLower) => {
    let best = rankOf(seats[0]);
    for (const seat of seats.slice(1)) {
      const cand = rankOf(seat);
      if (wantLower ? cmp(cand, best) < 0 : cmp(cand, best) > 0) best = cand;
    }
    return seats.filter((seat) => cmp(rankOf(seat), best) === 0);
  };

  const lowBySeat = new Map();
  if (evaluateLow) {
    for (const hand of hands) {
      const low = evaluateLow(state.players.find((p) => p.seat === hand.seat));
      if (low) lowBySeat.set(hand.seat, low);
    }
  }

  for (const [potIndex, pot] of state.pots.entries()) {
    const eligible = pot.eligibleSeats.filter((seat) => handBySeat.has(seat));
    if (eligible.length === 0) throw new Error(`pot ${potIndex} has no eligible player`);
    const highWinners = bestSeats(eligible, (s) => handBySeat.get(s), compare, false);
    const lowSeats = evaluateLow ? eligible.filter((s) => lowBySeat.has(s)) : [];
    let lowWinners = [];
    if (lowSeats.length) {
      lowWinners = bestSeats(lowSeats, (s) => lowBySeat.get(s), compareLow, true);
      distribute(Math.ceil(pot.amount / 2), highWinners);
      distribute(Math.floor(pot.amount / 2), lowWinners);
    } else {
      distribute(pot.amount, highWinners);
    }
    resultPots.push({ amount: pot.amount, eligibleSeats: [...eligible], winnerSeats: [...highWinners], lowWinnerSeats: [...lowWinners] });
  }

  state.payouts = [...payoutBySeat.entries()].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat);
  for (const payout of state.payouts) {
    state.players.find((p) => p.seat === payout.seat).stack += payout.amount;
    events.push({ type: "payout", seat: payout.seat, amount: payout.amount });
  }
  state.result = { type: "showdown", hands, pots: resultPots };
  state.street = "complete";
  events.push({ type: "showdown", hands });
  events.push({ type: "handComplete", result: state.result });
}

// Sole-survivor (everyone else folded): award the whole pot, returning any
// uncalled bet first. Mutates state + pushes events.
export function settleUncontested(state, events) {
  const winner = nonFolded(state)[0];
  const others = state.players.filter((p) => p.seat !== winner.seat);
  const highestOther = others.reduce((max, p) => Math.max(max, p.totalCommitted), 0);
  const uncalled = Math.max(0, winner.totalCommitted - highestOther);
  if (uncalled > 0) {
    winner.totalCommitted -= uncalled;
    winner.committedThisStreet = Math.max(0, winner.committedThisStreet - uncalled);
    winner.stack += uncalled;
    if (winner.status === "allin") winner.status = "active";
    events.push({ type: "uncalledBetReturned", seat: winner.seat, amount: uncalled });
  }
  const amount = state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  state.pots = amount > 0 ? [{ amount, eligibleSeats: [winner.seat] }] : [];
  state.payouts = amount > 0 ? [{ seat: winner.seat, amount }] : [];
  winner.stack += amount;
  state.toActSeat = null;
  state.result = { type: "uncontested", winnerSeat: winner.seat, amount, revealedHoleCards: false };
  state.street = "complete";
  if (amount > 0) events.push({ type: "payout", seat: winner.seat, amount });
  events.push({ type: "handComplete", result: state.result });
}
