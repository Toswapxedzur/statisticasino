// Blackjack as a GameModule — a "banked" game (players vs. the house/banker,
// not each other). It is a pure, deterministic state machine in the same shape
// as the poker engine (createRound / legalActions / applyAction / isComplete /
// settle) so the generic GameTable runtime can drive it exactly like poker.
//
// Round phases: "betting" (each player posts a wager) → "acting" (hit / stand /
// double, in seat order) → the dealer draws to 17 → "complete". settle() then
// returns per-seat chip deltas that SUM TO ZERO (a player's win is the banker's
// loss), so the runtime moves chips through escrow with conservation intact.
//
// v1 scope: hit / stand / double + naturals (3:2). Split, insurance and
// surrender are deliberately deferred.

import { standardDeck } from "../engine/cards.js";

export const DEFAULTS = {
  minBet: 1,
  dealerHitsSoft17: false, // dealer stands on soft 17
  blackjackNumerator: 3,   // naturals pay 3:2
  blackjackDenominator: 2
};

function cardValue(rank) {
  if (rank === "A") return 11;
  if ("TJQK".includes(rank)) return 10;
  return Number(rank);
}

// Best total <= 21 when possible; `soft` = an ace is still counted as 11.
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card[0]);
    if (card[0] === "A") aces += 1;
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function draw(state) {
  if (state.deckPos >= state.deck.length) throw new RangeError("shoe exhausted");
  return state.deck[state.deckPos++];
}

function playerSeatsInOrder(state) {
  return state.players.map((p) => p.seat).sort((a, b) => a - b);
}

function firstUnfinished(state, afterSeat = -1) {
  for (const seat of playerSeatsInOrder(state)) {
    if (seat > afterSeat && !state.players.find((p) => p.seat === seat).done) return seat;
  }
  return null;
}

// Deal the opening cards once every wager is in, then handle immediate naturals.
function deal(state) {
  const order = playerSeatsInOrder(state);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const seat of order) state.players.find((p) => p.seat === seat).cards.push(draw(state));
    state.dealer.cards.push(draw(state));
  }
  for (const p of state.players) {
    p.value = handValue(p.cards).total;
    p.blackjack = isBlackjack(p.cards);
    if (p.blackjack) p.done = true; // naturals stand automatically
  }
  state.dealer.blackjack = isBlackjack(state.dealer.cards);

  // Dealer peek: a dealer natural ends the round before anyone acts.
  if (state.dealer.blackjack) { finishDealer(state); return; }

  state.phase = "acting";
  state.toActSeat = firstUnfinished(state);
  if (state.toActSeat === null) finishDealer(state); // everyone had a natural
}

// Reveal the hole card, draw to the house rule, then compute results. The dealer
// only draws if at least one player is still live (all busted → dealer wins as
// dealt); a dealer natural was already resolved before anyone acted.
function finishDealer(state) {
  state.dealer.holeHidden = false;
  const someoneLive = state.players.some((p) => handValue(p.cards).total <= 21);
  if (someoneLive && !state.dealer.blackjack) {
    while (true) {
      const { total, soft } = handValue(state.dealer.cards);
      if (total < 17) { state.dealer.cards.push(draw(state)); continue; }
      if (total === 17 && soft && state.config.dealerHitsSoft17) { state.dealer.cards.push(draw(state)); continue; }
      break;
    }
  }
  const dv = handValue(state.dealer.cards);
  state.dealer.value = dv.total;
  state.dealer.bust = dv.total > 21;
  state.phase = "complete";
  state.toActSeat = null;
  state.results = computeResults(state);
}

function computeResults(state) {
  const { blackjackNumerator: bn, blackjackDenominator: bd } = state.config;
  const dealer = state.dealer;
  const dealerBJ = dealer.blackjack;
  const dealerTotal = handValue(dealer.cards).total;
  const dealerBust = dealerTotal > 21;

  const perSeat = [];
  let bankerDelta = 0;
  for (const p of state.players) {
    const bet = p.bet;
    const playerTotal = handValue(p.cards).total;
    const playerBust = playerTotal > 21;
    let delta;
    let outcome;
    if (p.blackjack && !dealerBJ) { delta = Math.floor((bet * bn) / bd); outcome = "blackjack"; }
    else if (p.blackjack && dealerBJ) { delta = 0; outcome = "push"; }
    else if (dealerBJ) { delta = -bet; outcome = "lose"; }
    else if (playerBust) { delta = -bet; outcome = "lose"; }
    else if (dealerBust) { delta = bet; outcome = "win"; }
    else if (playerTotal > dealerTotal) { delta = bet; outcome = "win"; }
    else if (playerTotal < dealerTotal) { delta = -bet; outcome = "lose"; }
    else { delta = 0; outcome = "push"; }
    perSeat.push({ seat: p.seat, delta, outcome, total: playerTotal, bet });
    bankerDelta -= delta;
  }
  perSeat.push({ seat: state.bankerSeat, delta: bankerDelta, outcome: "banker", total: dealerTotal });
  return perSeat;
}

// ------------------------------------------------------------- GameModule API

export const blackjack = {
  key: "blackjack",
  name: "Blackjack",
  family: "banked",
  usesBanker: true,
  minPlayers: 1,           // one player + the banker is a game
  deck: standardDeck,

  // ctx: { players:[{seat,userId,stack}], bankerSeat, deck, config }
  startRound(ctx) {
    const config = { ...DEFAULTS, ...(ctx.config || {}) };
    const state = {
      game: "blackjack",
      phase: "betting",
      config,
      bankerSeat: ctx.bankerSeat,
      deck: [...ctx.deck],
      deckPos: 0,
      dealer: { cards: [], value: 0, bust: false, blackjack: false, holeHidden: true },
      players: ctx.players
        .filter((p) => p.seat !== ctx.bankerSeat)
        .map((p) => ({
          seat: p.seat, userId: p.userId, startStack: p.stack,
          bet: 0, cards: [], done: false, doubled: false, blackjack: false, value: 0
        })),
      toActSeat: null,
      results: null
    };
    if (state.players.length === 0) { state.phase = "complete"; state.results = []; return state; }
    state.toActSeat = firstUnfinishedBettor(state);
    return state;
  },

  legalActions(state) {
    if (state.toActSeat === null) return { toActSeat: null, actions: [] };
    const player = state.players.find((p) => p.seat === state.toActSeat);
    if (!player) return { toActSeat: null, actions: [] };
    if (state.phase === "betting") {
      const max = player.startStack;
      return { toActSeat: state.toActSeat, actions: [{ type: "bet", min: state.config.minBet, max }] };
    }
    // acting
    const actions = [{ type: "hit" }, { type: "stand" }];
    if (player.cards.length === 2 && player.startStack >= player.bet * 2) actions.push({ type: "double" });
    return { toActSeat: state.toActSeat, actions };
  },

  applyAction(state, action) {
    const next = JSON.parse(JSON.stringify(state));
    const events = [];
    const player = next.players.find((p) => p.seat === action.seat);
    if (!player || next.toActSeat !== action.seat) throw new Error("not this seat's turn");

    if (next.phase === "betting") {
      if (action.type !== "bet") throw new Error("must place a bet");
      const amount = Number(action.amount);
      const max = player.startStack;
      if (!Number.isInteger(amount) || amount < next.config.minBet || amount > max) {
        throw new RangeError(`bet must be between ${next.config.minBet} and ${max}`);
      }
      player.bet = amount;
      events.push({ type: "bet", seat: player.seat, amount });
      const nextBettor = firstUnfinishedBettor(next, player.seat);
      if (nextBettor !== null) { next.toActSeat = nextBettor; return { state: next, events }; }
      deal(next);
      events.push({ type: "dealt" });
      return { state: next, events };
    }

    // acting phase
    if (action.type === "hit") {
      player.cards.push(draw(next));
      if (handValue(player.cards).total >= 21) player.done = true; // 21 auto-stands; bust ends turn
    } else if (action.type === "stand") {
      player.done = true;
    } else if (action.type === "double") {
      if (player.cards.length !== 2 || player.startStack < player.bet * 2) throw new Error("cannot double");
      player.bet *= 2;
      player.doubled = true;
      player.cards.push(draw(next));
      player.done = true;
    } else {
      throw new RangeError(`illegal action: ${action.type}`);
    }
    events.push({ type: action.type, seat: player.seat });

    const nextSeat = firstUnfinished(next, -1);
    if (nextSeat !== null) { next.toActSeat = nextSeat; return { state: next, events }; }
    finishDealer(next);
    events.push({ type: "dealerDone" });
    return { state: next, events };
  },

  isComplete(state) { return state.phase === "complete"; },
  actorSeat(state) { return state.toActSeat; },

  // Timeout default: fold-equivalent. In betting, post the minimum; while acting,
  // stand on what you have.
  defaultAction(state, seat) {
    return state.phase === "betting"
      ? { type: "bet", seat, amount: state.config.minBet }
      : { type: "stand", seat };
  },

  // Per-seat chip deltas (players + banker), summing to zero.
  settle(state) { return state.results || []; },

  // What everyone sees: the dealer (hole hidden until reveal) + each hand.
  publicView(state) {
    return {
      game: "blackjack",
      phase: state.phase,
      dealer: {
        cards: state.dealer.holeHidden && state.dealer.cards.length
          ? [state.dealer.cards[0], "??"]
          : [...state.dealer.cards],
        value: state.dealer.holeHidden ? null : handValue(state.dealer.cards).total,
        bust: state.dealer.bust
      },
      hands: state.players.map((p) => ({
        seat: p.seat, cards: [...p.cards], bet: p.bet,
        value: handValue(p.cards).total, bust: handValue(p.cards).total > 21,
        blackjack: p.blackjack, done: p.done, doubled: p.doubled
      })),
      toActSeat: state.toActSeat,
      results: state.results
    };
  },

  // Blackjack hands are open — nothing is private.
  privateFor() { return null; },

  turnInfo(state, seat) {
    const menu = this.legalActions(state);
    if (menu.toActSeat !== seat) return null;
    return { phase: state.phase, actions: menu.actions };
  }
};

function firstUnfinishedBettor(state, afterSeat = -1) {
  for (const seat of playerSeatsInOrder(state)) {
    if (seat > afterSeat && state.players.find((p) => p.seat === seat).bet === 0) return seat;
  }
  return null;
}
