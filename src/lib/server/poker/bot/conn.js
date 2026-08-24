// BotConn — a bot that plays like a real client, by BEING one.
//
// The whole poker stack routes to a "connection": an object with a `user`, a
// `watching` set, and a `send(frame)` method (see gateway.js). A human's conn
// writes frames to a WebSocket; a BotConn instead READS the frames it receives
// and, on its turn, acts. Because it only ever sees the same redacted frames a
// human at that seat sees — TABLE_STATE (public board), TABLE_PRIVATE (its own
// hole cards), TABLE_TURN (its legal menu) — it structurally cannot peek at
// anyone else's cards. It is a real seated user going through the identical
// buyIn→escrow and act() paths; nothing in table.js/hub.js knows it's a bot.
//
// Two rules make it correct:
//  1. NEVER act synchronously inside send(). sendTurnTo() is called from inside
//     the table's op-lock; the decision (a Monte-Carlo sim) is also expensive.
//     So we DEFER via an injectable scheduler (setTimeout in prod — this is also
//     the bot's "think time"), and the action lands as a fresh op-locked call.
//  2. Coalesce duplicate turns. A reconnect re-send or an illegal-action
//     re-prompt can deliver TABLE_TURN more than once; we keep only the latest
//     and decide once.

import { decode, S2C } from "../../../poker/protocol.js";
import { pokerStrategy } from "./poker-strategy.js";
import { createOpponentModel, combineReads } from "./opponent-model.js";

// Parse a public "lastAction" label (see table.js setLastAction) into an
// observation for the opponent model. Blinds (SB/BB) and null aren't decisions.
function parseAction(label) {
  switch (label ? label.split(" ")[0] : null) {
    case "Fold": return { action: "fold", facingBet: true };
    case "Check": return { action: "check", facingBet: false };
    case "Call": return { action: "call", facingBet: true };
    case "Bet": return { action: "bet", facingBet: false };
    case "Raise": return { action: "raise", facingBet: true };
    case "All-in": return { action: "allin", facingBet: null }; // resolve from committed
    default: return null;
  }
}

// Last-resort fallback if a strategy fails: pick a legal, zero-cost action.
function safeAction(turn) {
  const acts = turn.actions || [];
  for (const t of ["check", "stand", "call", "fold"]) {
    if (acts.some((a) => a.type === t)) return { type: t };
  }
  const bet = acts.find((a) => a.type === "bet");
  if (bet) return { type: "bet", amount: bet.min };
  return acts[0] ? { type: acts[0].type } : { type: "fold" };
}

// Prod think-time: a small jittered delay so bots don't snap-act instantly.
// Swallows a rejected act() promise so a transient table error can't surface as
// an unhandled rejection (the bot also receives any error as a frame).
function defaultSchedule(fn) {
  const ms = 600 + Math.floor(Math.random() * 1400);
  const t = setTimeout(() => { Promise.resolve(fn()).catch(() => {}); }, ms);
  t.unref?.();
  return t;
}

export class BotConn {
  // { user:{id,displayName}, tier, table, rng?, schedule?(fn)->handle, strategy?, onIdle? }
  constructor({ user, tier, table, rng = Math.random, schedule = defaultSchedule, strategy, onIdle = null } = {}) {
    if (!user || user.id == null) throw new Error("BotConn needs a user with an id");
    if (!tier) throw new Error("BotConn needs a tier");
    if (!table) throw new Error("BotConn needs a table");
    this.user = user;
    this.tier = tier;
    this.table = table;
    this.rng = rng;
    this._schedule = schedule;
    // The game brain. Defaults to poker; a blackjack bot gets blackjackStrategy.
    this.strategy = strategy || pokerStrategy;
    // Between-hands steward: called once per completed hand while we're idle at the
    // seat, so a staked bot's manager can decide whether to rebuy or quit. null for
    // bots nobody stakes (they just sit until removed).
    this.onIdle = onIdle;
    this._lastIdleHand = null;
    this._idleTimer = null;

    // Connection surface the table/hub expect.
    this.watching = new Set();
    this.alive = true;
    this.isBot = true;

    // Redacted view, rebuilt from frames.
    this.seat = null;      // our seat number (from TABLE_PRIVATE)
    this.hole = null;      // our hole cards
    this.view = null;      // latest public table view (board, seats, street)

    // Adaptive tiers ("pro") keep a per-opponent model, fed by diffing the public
    // lastAction labels across TABLE_STATE frames (frames only — no peeking).
    this._model = tier && tier.adaptive ? createOpponentModel() : null;
    this._seenActions = new Set(); // dedupe key: hand:seat:street:label
    this._lastHandNo = null;

    this._pendingTurn = null; // latest TABLE_TURN awaiting a decision
    this._scheduled = false;  // a decision is already queued
    this._timer = null;       // scheduler handle (for cancel on detach)
    this._detached = false;
  }

  get id() { return this.user.id; }

  // Receive a server frame (string or already-parsed object).
  send(data) {
    if (this._detached) return;
    const msg = typeof data === "string" ? decode(data) : data;
    if (!msg) return;
    if (msg.tableId !== undefined && msg.tableId !== this.table.id) return; // other table
    switch (msg.t) {
      case S2C.TABLE_STATE:
        this.view = msg.table;
        // Learn our seat from the public view — the only source in games with no
        // private frame (blackjack hands are face-up, so no TABLE_PRIVATE).
        if (this.seat == null && this.user?.id != null) {
          const mine = (msg.table?.seats || []).find((s) => s.userId === this.user.id);
          if (mine) this.seat = mine.seat;
        }
        if (this._model) this._observeFromView(msg.table);
        this._maybeIdle();
        break;
      case S2C.TABLE_PRIVATE:
        this.seat = msg.seat;
        this.hole = msg.holeCards ? [...msg.holeCards] : null;
        break;
      case S2C.TABLE_TURN:
        if (msg.seat === this.seat) this._onTurn(msg);
        break;
      default:
        break; // chips / chat / error / toast / left — nothing to do
    }
  }

  _onTurn(turn) {
    this._pendingTurn = turn;
    if (this._scheduled) return; // the queued decision will read the latest turn
    this._scheduled = true;
    this._timer = this._schedule(() => this._decideAndSubmit());
  }

  // Diff a public view's lastAction labels into per-opponent observations. Keyed
  // by (hand, seat, street, label) so a repeated/HMR frame is counted once, but
  // the same action on a new street counts again.
  _observeFromView(view) {
    if (!view) return;
    const handNo = view.handNo;
    if (handNo !== this._lastHandNo) { this._lastHandNo = handNo; this._seenActions.clear(); }
    const seats = view.seats || [];
    const boardLen = (view.board || []).length;
    const maxCommitted = seats.reduce((m, s) => Math.max(m, s.committed || 0), 0);
    for (const s of seats) {
      if (s.seat === this.seat || s.userId == null) continue; // skip self + empties
      const parsed = parseAction(s.lastAction);
      if (!parsed) continue;
      const key = `${handNo}:${s.seat}:${boardLen}:${s.lastAction}`;
      if (this._seenActions.has(key)) continue;
      this._seenActions.add(key);
      const facingBet = parsed.facingBet == null ? maxCommitted > (s.committed || 0) : parsed.facingBet;
      const voluntary = ["call", "bet", "raise", "allin"].includes(parsed.action);
      this._model.observe(s.userId, {
        action: parsed.action, facingBet,
        vpipChance: boardLen === 0, voluntary: boardLen === 0 && voluntary
      });
    }
  }

  // When OUR seat is between hands, fire the steward once per table-hand so the
  // manager can rebuy or quit. We gate on our OWN seat being idle (not the table
  // phase): on a busy table hands run back-to-back, but a busted bot sits out
  // those hands and still needs to rebuy/leave — and a seat that isn't in the
  // current hand is exactly when a rebuy is allowed. Deferred off the scheduler
  // because this runs inside a broadcast (op-lock) that the steward re-enters.
  _maybeIdle() {
    if (!this.onIdle || this._detached || this._idleTimer != null) return;
    const v = this.view;
    if (!v) return;
    const mine = (v.seats || []).find((s) => s.userId === this.user.id);
    if (!mine || mine.inHand) return;              // playing a hand — not idle
    if (v.handNo === this._lastIdleHand) return;   // once per table-hand
    this._lastIdleHand = v.handNo;
    this._idleTimer = this._schedule(() => {
      this._idleTimer = null;
      if (!this._detached) Promise.resolve(this.onIdle?.()).catch(() => {});
    });
  }

  // The adaptive read of the opponents still contesting the pot (null otherwise).
  _read() {
    if (!this._model || !this.view) return null;
    const opps = (this.view.seats || [])
      .filter((s) => s.seat !== this.seat && s.inHand && s.status !== "folded" && s.userId != null)
      .map((s) => this._model.read(s.userId));
    return combineReads(opps);
  }

  _decideAndSubmit() {
    this._scheduled = false;
    this._timer = null;
    const turn = this._pendingTurn;
    this._pendingTurn = null;
    if (this._detached || !turn) return;

    let action;
    try {
      // The strategy only ever gets this seat's redacted view — hole cards +
      // public state — so it can't peek. It returns a legal { type, amount? }.
      action = this.strategy.decide({
        view: this.view,
        turn,
        hole: this.hole,
        seat: this.seat,
        tier: this.tier,
        rng: this.rng,
        variantKey: this.table?.variantKey,
        read: this._read() // adaptive opponent read (null for non-adaptive tiers)
      });
    } catch {
      action = null;
    }
    if (!action || typeof action.type !== "string") action = safeAction(turn);
    // Submit through the SAME op-locked entry a human's TABLE_ACTION reaches.
    return this.table.act(this, action);
  }

  // Stop the bot from acting (called when it's removed / the table closes).
  detach() {
    this._detached = true;
    for (const key of ["_timer", "_idleTimer"]) {
      if (this[key] != null) {
        try { clearTimeout(this[key]); } catch { /* injected scheduler handle */ }
        this[key] = null;
      }
    }
  }
}
