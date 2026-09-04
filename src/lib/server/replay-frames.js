// Frame expansion for recorded matches (see poker/recorder.js). A replay
// document stores only the deterministic INPUTS (deck + config + players +
// action log); this module re-simulates the pure engines server-side and emits
// the per-step frames a viewer pages through. The raw document (and above all
// the deck) never leaves the server — redaction happens here.
//
// If re-simulation throws (an engine's behaviour drifted since the recording),
// callers fall back to the stored `final` summary.

import { createHand, applyAction as pokerApply } from "./poker/engine/index.js";
import { GAMES } from "./poker/games/registry.js";

// ---- hold'em (all poker variants) -----------------------------------------

function pokerSnap(state, action) {
  return {
    action: action ? { seat: action.s, type: action.type, amount: action.amount ?? null, auto: !!action.auto } : null,
    street: state.street ?? null,
    board: [...(state.board || [])],
    pot: (state.players || []).reduce((sum, p) => sum + (p.totalCommitted || 0), 0),
    toActSeat: state.toActSeat ?? null,
    players: (state.players || []).map((p) => ({
      seat: p.seat,
      stack: p.stack,
      committed: p.committedThisStreet ?? 0,
      totalCommitted: p.totalCommitted ?? 0,
      status: p.status
    }))
  };
}

function holdemFrames(doc) {
  let state = createHand({
    variant: doc.variant || "holdem",
    players: doc.players.map((p) => ({ id: p.seat, seat: p.seat, stack: p.stack })),
    buttonSeat: doc.buttonSeat,
    smallBlind: doc.config.smallBlind,
    bigBlind: doc.config.bigBlind,
    straddle: doc.config.straddle,
    runItTwice: doc.config.runItTwice,
    deck: [...doc.deck]
  });
  const frames = [pokerSnap(state, null)];
  for (const a of doc.actions) {
    const { s, t: _t, auto: _a, ...rest } = a;
    ({ state } = pokerApply(state, { ...rest, seat: s }));
    frames.push(pokerSnap(state, a));
  }
  // Per-seat hole cards from the finished state (redacted later per viewer).
  const holes = {};
  for (const p of state.players || []) holes[p.seat] = [...(p.holeCards || [])];
  return { kind: "poker", frames, holes };
}

// ---- GameModules (banked + shedding + solo) --------------------------------

function moduleFrames(doc) {
  const game = GAMES[doc.mode];
  if (!game) return null;
  let state = game.startRound({
    players: doc.players.map((p) => ({ seat: p.seat, userId: p.userId ?? null, stack: p.stack })),
    bankerSeat: doc.bankerSeat ?? null,
    deck: [...(doc.deck || [])],
    config: doc.config || {}
  });
  const frames = [{ action: null, view: game.publicView(state) }];
  for (const a of doc.actions) {
    const { s, t: _t, auto, ...rest } = a;
    ({ state } = game.applyAction(state, { ...rest, seat: s }));
    frames.push({
      action: { seat: s, type: a.type, amount: a.amount ?? null, auto: !!auto },
      view: game.publicView(state)
    });
  }
  return { kind: "module", frames, holes: null };
}

// Expand a parsed replay document into viewer frames, or null on failure.
export function expandFrames(doc) {
  try {
    if (!doc || doc.v !== 1) return null;
    return doc.mode === "holdem" ? holdemFrames(doc) : moduleFrames(doc);
  } catch {
    return null;
  }
}

// Which seats' hole cards `viewer` may see: their own seat (if a participant)
// plus every seat revealed at showdown. Everything else stays face-down even
// for participants — you only ever see what you could see at the table.
export function visibleHoleSeats(doc, participants, viewerUserId) {
  const seats = new Set();
  if (viewerUserId) {
    for (const p of participants) if (p.user_id === viewerUserId) seats.add(p.seat);
  }
  for (const r of doc.final?.result?.revealed || []) seats.add(r.seat);
  return seats;
}
