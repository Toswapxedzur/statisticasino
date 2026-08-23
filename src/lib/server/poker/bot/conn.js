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
  // { user:{id,displayName}, tier, table, rng?, schedule?(fn)->handle, strategy? }
  constructor({ user, tier, table, rng = Math.random, schedule = defaultSchedule, strategy } = {}) {
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
        // Learn our seat from the public view — the only source in games with no
        // private frame (blackjack hands are face-up, so no TABLE_PRIVATE).
        if (this.seat == null && this.user?.id != null) {
          const mine = (msg.table?.seats || []).find((s) => s.userId === this.user.id);
          if (mine) this.seat = mine.seat;
        }
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
        variantKey: this.table?.variantKey
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
    if (this._timer != null) {
      try { clearTimeout(this._timer); } catch { /* injected scheduler handle */ }
      this._timer = null;
    }
  }
}
