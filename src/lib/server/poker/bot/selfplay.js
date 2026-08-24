// Bot-vs-bot self-play harness — how we VALIDATE that a bot change is actually an
// improvement (per the bot plan). Plays many full flop-poker hands between a set
// of tiers with a seeded RNG and returns net chips per seat. Stacks reset each
// hand, so the result is per-hand chip EV; rotating the button keeps positions
// fair. Works for any flop variant (Hold'em / Omaha / Short Deck / Omaha Hi-Lo).
//
// Two entry points:
//   playMatch    — N tiers, one shared RNG, raw net chips per seat. Simple, but
//                  raw EV is noisy (stack-offs → several bb/hand SD).
//   duplicateEdge — CARD-MATCHED comparison of two tiers vs the same villain on
//                  identical decks with matched decision RNG, so the delta isolates
//                  strategy from variance. The reliable way to prove one beats
//                  another (the "duplicate poker" technique — see bot notes).

import { createHand, legalActions, applyAction } from "../engine/holdem.js";
import { shuffle } from "../engine/cards.js";
import { getVariant } from "../engine/variants.js";
import { actFor } from "./decide.js";
import { createOpponentModel, combineReads } from "./opponent-model.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turn a seat's pre-action state into an observation for the opponent models.
function evFor(state, seat, action) {
  const me = state.players.find((p) => p.seat === seat);
  const toCall = state.currentBet - (me ? me.committedThisStreet : 0);
  const preflop = state.board.length === 0; // variant-agnostic VPIP window
  const voluntary = ["call", "bet", "raise", "allin"].includes(action.type);
  return { action: action.type, facingBet: toCall > 0, vpipChance: preflop, voluntary: preflop && voluntary };
}

// Play one hand to completion, feeding each adaptive seat's opponent model and
// letting it read its opponents. Mutates `state` locally; returns the final state.
function playHand(state, tiers, rng, models) {
  let guard = 0;
  while (state.street !== "complete" && state.toActSeat != null) {
    if (guard++ > 400) break;
    const seat = state.toActSeat;
    try {
      // Adaptive seat: read its still-contesting opponents and lean into the exploit.
      let read = null;
      const model = models.get(seat);
      if (model) {
        const oppSeats = state.players
          .filter((p) => p.seat !== seat && p.status !== "folded")
          .map((p) => p.seat);
        read = combineReads(oppSeats.map((s) => model.read(s)));
      }
      const action = actFor(state, seat, tiers[seat - 1], rng, read);
      const ev = evFor(state, seat, action);
      state = applyAction(state, action).state;
      // Every OTHER adaptive seat records this action against `seat` as its opponent.
      for (const [obsSeat, m] of models) if (obsSeat !== seat) m.observe(seat, ev);
    } catch { break; }
  }
  return state;
}

// Adaptive tiers each carry their OWN opponent model, persisting across hands so
// the read sharpens over the match (the whole point of Tier 2). Non-adaptive tiers
// get no model, so reads stay null and their play is unchanged.
function modelsFor(tiers) {
  const models = new Map(); // seat -> opponent model
  tiers.forEach((t, i) => { if (t && t.adaptive) models.set(i + 1, createOpponentModel()); });
  return models;
}

// playMatch({ tiers, hands, seed, variant, ... }) -> net chips per seat (index = seat-1).
export function playMatch({ tiers, hands, seed = 1, variant = "holdem", startStack = 1000, sb = 5, bb = 10 }) {
  void legalActions; // actFor uses it internally; kept in imports for clarity
  const rng = mulberry32(seed);
  const n = tiers.length;
  const net = new Array(n).fill(0);
  const deckFactory = getVariant(variant).deck;
  const models = modelsFor(tiers);

  for (let h = 0; h < hands; h += 1) {
    const players = tiers.map((_, i) => ({ id: i + 1, seat: i + 1, stack: startStack }));
    const deck = shuffle(deckFactory(), rng);
    let state;
    try { state = createHand({ players, buttonSeat: (h % n) + 1, smallBlind: sb, bigBlind: bb, deck, variant }); }
    catch { continue; }
    state = playHand(state, tiers, rng, models);
    for (const pl of state.players) net[pl.seat - 1] += pl.stack - startStack;
  }
  return net;
}

// Heads-up: hero (seat 1, adaptive-modelling the villain) vs villain (seat 2) over
// the GIVEN decks, each hand using a fresh decision RNG seeded from the hand index
// — so a second call with a different hero replays identical cards AND MC luck.
function replayHeadsUp(heroTier, villainTier, decks, { variant, startStack, sb, bb, rngBase }) {
  const tiers = [heroTier, villainTier];
  const models = modelsFor(tiers);
  let heroNet = 0;
  decks.forEach((deck, h) => {
    const rng = mulberry32(rngBase + h); // per-deck decision RNG — matched across heroes
    const players = [{ id: 1, seat: 1, stack: startStack }, { id: 2, seat: 2, stack: startStack }];
    let state;
    try { state = createHand({ players, buttonSeat: (h % 2) + 1, smallBlind: sb, bigBlind: bb, deck: [...deck], variant }); }
    catch { return; }
    state = playHand(state, tiers, rng, models);
    heroNet += state.players.find((p) => p.seat === 1).stack - startStack;
  });
  return heroNet;
}

// Card-matched comparison: play the SAME decks with hero = A and hero = B (both vs
// the same villain, matched decision RNG), and return A_net − B_net. Cards and MC
// luck cancel, so a positive edge means A genuinely out-plays B — no thousands of
// hands needed to see through variance.
export function duplicateEdge({
  heroTier, baselineTier, villainTier, hands = 300,
  deckSeed = 777, rngBase = 100000, variant = "holdem", startStack = 1000, sb = 5, bb = 10
}) {
  const deckRng = mulberry32(deckSeed);
  const deckFactory = getVariant(variant).deck;
  const decks = Array.from({ length: hands }, () => shuffle(deckFactory(), deckRng));
  const opts = { variant, startStack, sb, bb, rngBase };
  const heroNet = replayHeadsUp(heroTier, villainTier, decks, opts);
  const baseNet = replayHeadsUp(baselineTier, villainTier, decks, opts);
  return { edge: heroNet - baseNet, heroNet, baseNet, hands };
}
