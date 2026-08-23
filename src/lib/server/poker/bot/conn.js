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
import { decide } from "./decide.js";

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
  // { user:{id,displayName}, tier, table, rng?, schedule?(fn)->handle }
  constructor({ user, tier, table, rng = Math.random, schedule = defaultSchedule } = {}) {
    if (!user || user.id == null) throw new Error("BotConn needs a user with an id");
    if (!tier) throw new Error("BotConn needs a tier");
    if (!table) throw new Error("BotConn needs a table");
    this.user = user;
    this.tier = tier;
    this.table = table;
    this.rng = rng;
    this._schedule = schedule;

    // Connection surface the table/hub expect.
    this.watching = new Set();
    this.alive = true;
    this.isBot = true;

    // Redacted view, rebuilt from frames.
    this.seat = null;      // our seat number (from TABLE_PRIVATE)
    this.hole = null;      // our hole cards
    this.view = null;      // latest public table view (board, seats, street)

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

  // Assemble the decision input purely from what a client at this seat can see.
  _buildObs(turn) {
    const view = this.view || {};
    const board = view.board || [];
    const seats = view.seats || [];
    // Opponents still contesting the pot: seated, dealt in, not folded.
    const numOpponents = seats.filter(
      (s) => s.seat !== this.seat && s.inHand && s.status !== "folded"
    ).length;
    return {
      hole: this.hole ? [...this.hole] : [],
      board: [...board],
      street: view.street || null,
      toCall: turn.callAmount || 0,
      pot: turn.potTotal || 0,
      currentBet: turn.currentBet || 0,
      minRaise: turn.minRaise || 0,
      numOpponents,
      actions: turn.actions || []
    };
  }

  _decideAndSubmit() {
    this._scheduled = false;
    this._timer = null;
    const turn = this._pendingTurn;
    this._pendingTurn = null;
    if (this._detached || !turn) return;

    const safe = () =>
      (turn.actions || []).some((a) => a.type === "check") ? { type: "check" } : { type: "fold" };

    let action;
    try {
      const obs = this._buildObs(turn);
      // No cards yet, or nobody left to act against — take the free/cheap out.
      action = (obs.hole.length < 2 || obs.numOpponents < 1)
        ? safe()
        : decide(obs, this.tier, this.rng);
    } catch {
      action = safe();
    }
    // Submit through the SAME op-locked entry a human's TABLE_ACTION reaches.
    return this.table.act(this, action);
  }

  // Stop the bot from acting (called when it's removed / the table closes).
  detach() {
    this._detached = true;
    if (this._timer != null) {
      try { clearTimeout(this._timer); } catch { /* injected scheduler handle */ }
      this._timer = null;
    }
  }
}
