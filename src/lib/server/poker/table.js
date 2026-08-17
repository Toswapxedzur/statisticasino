// LiveTable — the in-memory authoritative state of one poker table.
//
// This is the real-time orchestrator described in DESIGN.md §1. It drives
// the pure Hold'em engine (createHand/legalActions/applyAction) through a
// full hand lifecycle, routes public/private frames to watchers, arms the
// per-decision action clock, and reconciles chips against the wallet.
//
// Everything time/DB/random goes through injectable `deps` so the sim test
// can play thousands of deterministic hands with no DB or wall clock.
//
// Seats are keyed by seat number and identified by userId. Connectivity is
// DERIVED from the current watcher set (a watcher whose conn.user.id ===
// seat.userId) — we never store a socket on a seat, so multi-tab and
// reconnect "just work".

import { encode, S2C } from "../../poker/protocol.js";
import {
  createHand,
  legalActions,
  applyAction,
  standardDeck,
  shuffle
} from "./engine/index.js";
import * as realBank from "./bank.js";
import * as realStore from "./store.js";

// --------------------------------------------------------------- timing
export const ACTION_TIMEOUT_MS = 25_000; // per-decision clock
export const NEW_HAND_DELAY_MS = 3_500; // pause after a hand before the next
export const DISCONNECT_GRACE_MS = 8_000; // shortened clock for a gone actor
export const SEAT_VACATE_GRACE_MS = 45_000; // auto-stand a fully-gone idle seat

export class LiveTable {
  constructor(config, hub, deps = {}) {
    this.hub = hub;
    this.id = config.id;
    this.config = {
      id: config.id,
      name: config.name,
      variant: config.variant || "holdem",
      maxSeats: config.max_seats ?? config.maxSeats ?? 9,
      smallBlind: config.small_blind ?? config.smallBlind,
      bigBlind: config.big_blind ?? config.bigBlind,
      minBuyin: config.min_buyin ?? config.minBuyin,
      maxBuyin: config.max_buyin ?? config.maxBuyin
    };

    // Injectable dependencies (see DESIGN.md §1). Defaults are the real
    // modules / platform primitives; tests override every one of them.
    // `wallet` is the bank layer (buyIn/cashOut/syncStacks) — chip moves that
    // are atomic with the durable escrow mirror (see bank.js).
    this.wallet = deps.wallet || realBank;
    this.store = deps.store || realStore;
    this.now = deps.now || (() => Date.now());
    this.setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer || ((t) => clearTimeout(t));
    this.rng = deps.rng || Math.random;
    this.autoStart = deps.autoStart ?? true;

    // seat number (0..maxSeats-1) -> seat object
    this.seats = new Map();
    // connections currently watching this table (seated players included)
    this.watchers = new Set();

    // current-hand bookkeeping
    this.hand = null; // engine HandState while a hand runs, else null
    this.handNo = 0;
    this.buttonSeat = null;
    this.sbSeat = null;
    this.bbSeat = null;
    this.actionDeadline = null;
    this._handStartedAt = null;

    // post-hand result window (kept until the next hand begins so clients
    // can render the outcome for ~NEW_HAND_DELAY_MS)
    this.result = null;
    this.resultBoard = null;
    this.resultPots = [];
    this.resultPotTotal = 0;

    // timer handles
    this.actionTimer = null;
    this.startTimer = null;
    // Monotonic generation for the action clock. Bumped whenever the clock is
    // cleared or re-armed so a timer callback that already fired and is queued
    // behind the op-lock can detect it's stale and bail (#6).
    this._actionGen = 0;

    // Async op-lock. Every mutating entry point (sit/stand/rebuy/act/
    // addWatcher/onConnectionGone + the timer callbacks) runs through
    // _run so an await inside one op (wallet debit/credit, nextHandNo)
    // can never interleave with another op. Without this, the gateway
    // dispatches messages without awaiting, so two frames could both
    // observe pre-mutation state and, e.g., cash a seat out twice
    // (minting chips). Serializing makes each op atomic end-to-end.
    this._opLock = Promise.resolve();
  }

  // Serialize a mutating operation behind any in-flight one. Errors are
  // isolated so one failed op doesn't wedge the queue.
  _run(fn) {
    const result = this._opLock.then(() => fn());
    this._opLock = result.then(() => {}, () => {});
    return result;
  }

  // ------------------------------------------------------- small helpers

  seatedCount() {
    return this.seats.size;
  }

  isEmpty() {
    return this.seats.size === 0 && this.watchers.size === 0;
  }

  seatForUser(userId) {
    if (userId == null) return null;
    for (const s of this.seats.values()) if (s.userId === userId) return s;
    return null;
  }

  // Any watcher connection owned by this user?
  isConnected(seat) {
    if (!seat) return false;
    for (const conn of this.watchers) {
      if (conn.user && conn.user.id === seat.userId) return true;
    }
    return false;
  }

  connsForUser(userId) {
    const out = [];
    for (const conn of this.watchers) {
      if (conn.user && conn.user.id === userId) out.push(conn);
    }
    return out;
  }

  enginePlayer(seatNo) {
    if (!this.hand) return null;
    return this.hand.players.find((p) => p.seat === seatNo) || null;
  }

  // Live chips in the middle = sum of every dealt player's totalCommitted
  // (which the engine keeps in sync with its side-pot layers).
  _livePot() {
    if (!this.hand) return 0;
    return this.hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  }

  clearActionTimer() {
    if (this.actionTimer != null) {
      this.clearTimer(this.actionTimer);
      this.actionTimer = null;
    }
    // Invalidate any callback that already fired and is waiting on the op-lock:
    // it captured the old generation and will bail (#6).
    this._actionGen += 1;
  }

  // Arm the per-decision action clock with a stale-callback guard. Capture the
  // generation now; if the timer fires and anything since cleared/re-armed the
  // clock (a real action landed, the actor reconnected, the hand ended) the
  // queued autoAct sees a newer generation and does nothing — so it can never
  // auto-act against whoever happens to be to-act by the time it runs (#6).
  _armActionTimer(ms) {
    this.clearActionTimer(); // clears the handle and bumps the generation
    const gen = this._actionGen;
    this.actionDeadline = this.now() + ms;
    this.actionTimer = this.setTimer(() => {
      this.actionTimer = null;
      return this._run(() => {
        if (this._actionGen !== gen) return; // superseded before we got the lock
        return this.autoAct();
      });
    }, ms);
  }

  clearStartTimer() {
    if (this.startTimer != null) {
      this.clearTimer(this.startTimer);
      this.startTimer = null;
    }
  }

  // ------------------------------------------------------- watchers

  // Synchronous (no chip-moving await), so it's already atomic w.r.t.
  // other ops; no op-lock needed.
  addWatcher(conn) {
    this.watchers.add(conn);
    conn.watching.add(this.id);
    conn.send(
      encode(S2C.TABLE_STATE, { tableId: this.id, table: this.publicView() })
    );
    // Re-send this user's private cards + (if it's their turn) the menu, so
    // a reconnecting / multi-tab client resumes cleanly.
    this.sendPrivateTo(conn);
    const seat = this.seatForUser(conn.user?.id);
    // Reconnected within the grace window → cancel the pending auto-stand.
    if (seat) this.clearVacateTimer(seat);
    if (seat && this.hand && this.hand.toActSeat === seat.seat) {
      // #7: if this seat was on the shortened disconnect clock, the actor
      // is back — restore a full decision clock so we don't auto-fold a
      // present player. (Only when it was actually a grace clock, so a
      // second tab can't be used to keep extending the clock.)
      if (seat._graceClock && this.isConnected(seat)) {
        seat._graceClock = false;
        this._armActionTimer(ACTION_TIMEOUT_MS);
      }
      this.sendTurnTo(seat);
    }
    // Reconnect changes derived connectivity → may enable a hand.
    this.broadcast();
    this.maybeStartHand();
  }

  removeWatcher(conn) {
    this.watchers.delete(conn);
    conn.watching.delete(this.id);
    // Connectivity for a seated user may have dropped; let others see it.
    this.broadcast();
  }

  // ------------------------------------------------------- views

  publicView() {
    const hand = this.hand;
    const board = hand ? [...hand.board] : this.result ? [...this.resultBoard] : [];
    const potTotal = hand ? this._livePot() : this.result ? this.resultPotTotal : 0;
    const pots = hand ? hand.pots.map((p) => ({ ...p })) : this.result ? this.resultPots : [];
    const street = hand ? hand.street : this.result ? "complete" : null;
    const toActSeat = hand ? hand.toActSeat : null;
    const actionDeadline = hand && toActSeat !== null ? this.actionDeadline : null;

    const seats = [];
    for (const [seatNo, s] of this.seats) {
      const ep = this.enginePlayer(seatNo);
      seats.push({
        seat: seatNo,
        userId: s.userId,
        name: s.name,
        stack: ep ? ep.stack : s.stack,
        committed: ep ? ep.committedThisStreet : 0,
        status: s.inHand ? (ep ? ep.status : s.status) : null,
        inHand: !!s.inHand,
        hasCards: !!(s.holeCards && s.holeCards.length),
        sittingOut: !!s.sittingOut,
        connected: this.isConnected(s),
        isButton: seatNo === this.buttonSeat,
        isSB: seatNo === this.sbSeat,
        isBB: seatNo === this.bbSeat,
        isToAct: hand ? seatNo === toActSeat : false,
        lastAction: s.lastAction ?? null
      });
    }
    seats.sort((a, b) => a.seat - b.seat);

    return {
      id: this.id,
      config: this.config,
      phase: hand || this.result ? "running" : "waiting",
      handNo: this.handNo,
      buttonSeat: this.buttonSeat,
      street,
      board,
      potTotal,
      pots,
      toActSeat,
      actionDeadline,
      seats,
      result: this.result ?? null
    };
  }

  lobbyRow() {
    return {
      id: this.id,
      name: this.config.name,
      variant: this.config.variant,
      maxSeats: this.config.maxSeats,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyin: this.config.minBuyin,
      maxBuyin: this.config.maxBuyin,
      seated: this.seats.size,
      watchers: this.watchers.size
    };
  }

  // Push the private hole cards for whichever seat this connection owns.
  sendPrivateTo(conn) {
    const seat = this.seatForUser(conn.user?.id);
    if (seat && seat.holeCards && seat.holeCards.length) {
      conn.send(
        encode(S2C.TABLE_PRIVATE, {
          tableId: this.id,
          seat: seat.seat,
          holeCards: [...seat.holeCards]
        })
      );
    }
  }

  sendAllPrivates() {
    for (const conn of this.watchers) this.sendPrivateTo(conn);
  }

  broadcast() {
    const msg = encode(S2C.TABLE_STATE, {
      tableId: this.id,
      table: this.publicView()
    });
    for (const conn of this.watchers) conn.send(msg);
  }

  sendChips(userId, chips) {
    const msg = encode(S2C.CHIPS, { chips });
    for (const conn of this.connsForUser(userId)) conn.send(msg);
  }

  _error(conn, msg, code) {
    conn.send(encode(S2C.ERROR, code ? { code, msg } : { msg }));
  }

  // Send the TABLE_TURN menu to the acting user's connections.
  sendTurnTo(seat) {
    if (!this.hand) return;
    const menu = legalActions(this.hand);
    if (menu.toActSeat !== seat.seat) return;
    const call = menu.actions.find((a) => a.type === "call");
    const payload = {
      tableId: this.id,
      seat: seat.seat,
      deadline: this.actionDeadline,
      callAmount: call ? call.amount : 0,
      currentBet: this.hand.currentBet,
      minRaise: this.hand.minRaise,
      potTotal: this._livePot(),
      actions: menu.actions
    };
    const msg = encode(S2C.TABLE_TURN, payload);
    for (const conn of this.connsForUser(seat.userId)) conn.send(msg);
  }

  // ------------------------------------------------------- eligibility

  // Occupied, not sitting out, has chips, and connected.
  eligibleSeats() {
    const out = [];
    for (const s of this.seats.values()) {
      if (!s.sittingOut && s.stack >= 1 && this.isConnected(s)) out.push(s);
    }
    out.sort((a, b) => a.seat - b.seat);
    return out;
  }

  advanceButton(eligibleSeatNos) {
    if (this.buttonSeat === null) return eligibleSeatNos[0];
    const higher = eligibleSeatNos.filter((n) => n > this.buttonSeat);
    return higher.length ? higher[0] : eligibleSeatNos[0];
  }

  // ------------------------------------------------------- hand lifecycle

  maybeStartHand() {
    if (this.hand) return; // a hand is in progress
    if (!this.autoStart) return; // tests drive beginHand() manually
    if (this.startTimer != null) return; // already scheduled
    if (this.eligibleSeats().length < 2) return;
    this.startTimer = this.setTimer(() => {
      this.startTimer = null;
      return this._run(() => this.beginHand());
    }, NEW_HAND_DELAY_MS);
  }

  async beginHand() {
    if (this.hand) return;
    this.clearStartTimer();

    if (this.eligibleSeats().length < 2) return;

    // Fetch the hand number BEFORE creating/exposing the hand. Previously
    // this.hand was assigned and THEN we awaited nextHandNo — a window in
    // which the hand was live but seats were still inHand=false and their
    // engine-committed chips lived only inside this.hand. A stand()/rebuy()/
    // act() landing there corrupted chips (#2/#6). Fetching first also lets
    // a DB failure abort cleanly instead of freezing a half-built hand (#8).
    let handNo;
    try {
      handNo = await this.store.nextHandNo(this.id);
    } catch {
      return; // maybeStartHand() retries on the next trigger
    }

    // The op-lock keeps other mutations out during the await, but re-check
    // in case state changed earlier in this same locked op.
    if (this.hand) return;
    const eligible = this.eligibleSeats().map((s) => s.seat);
    if (eligible.length < 2) return;

    const button = this.advanceButton(eligible);
    // Seat NUMBER is both the engine player id and seat, so mapping back is
    // trivial.
    const players = eligible.map((seatNo) => {
      const s = this.seats.get(seatNo);
      return { id: seatNo, seat: seatNo, stack: s.stack };
    });
    const deck = shuffle(standardDeck(), this.rng);

    let hand;
    try {
      hand = createHand({
        players,
        buttonSeat: button,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        deck
      });
    } catch {
      return; // bad config; retry next trigger
    }

    // ---- commit the hand ATOMICALLY: no await between here and the seat
    // setup below, so the hand is never observable with uninitialised seats.
    this.buttonSeat = button;
    this.hand = hand;
    this.handNo = handNo;
    this._handStartedAt = this.now();

    // Clear the previous result window now that a new hand is starting.
    this.result = null;
    this.resultBoard = null;
    this.resultPots = [];
    this.resultPotTotal = 0;

    const blinds = hand.initialEvents.find((e) => e.type === "blindsPosted");
    this.sbSeat = blinds?.smallBlind?.seat ?? null;
    this.bbSeat = blinds?.bigBlind?.seat ?? null;

    // Copy engine hole cards + hand-scoped fields onto seats.
    for (const p of hand.players) {
      const s = this.seats.get(p.seat);
      if (!s) continue;
      s.inHand = true;
      s.holeCards = [...p.holeCards];
      s.status = p.status;
      s.committedThisStreet = p.committedThisStreet;
      s.totalCommitted = p.totalCommitted;
      s.stackAtHandStart = s.stack;
      s.lastAction = null;
    }
    const sb = this.seats.get(this.sbSeat);
    if (sb) sb.lastAction = "SB";
    const bb = this.seats.get(this.bbSeat);
    if (bb) bb.lastAction = "BB";

    // holeCardsDealt is routed PRIVATELY; everything else is public state.
    this.sendAllPrivates();
    this.broadcast();
    this.hub?.onTableChanged?.(this); // lobby status -> "playing"
    await this.promptActor();
  }

  async promptActor() {
    if (!this.hand) return;
    if (this.hand.street === "complete" || this.hand.toActSeat === null) {
      await this.finishHand();
      return;
    }
    const seat = this.seats.get(this.hand.toActSeat);
    const gone = !!(seat && (!this.isConnected(seat) || seat.sittingOut));
    if (seat) seat._graceClock = gone; // #7: lets a reconnect restore a full clock
    const timeout = gone ? DISCONNECT_GRACE_MS : ACTION_TIMEOUT_MS;
    this._armActionTimer(timeout);

    this.broadcast();
    if (seat) this.sendTurnTo(seat);
  }

  act(conn, action) {
    return this._run(() => this._act(conn, action));
  }

  async _act(conn, action) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat) return this._error(conn, "You are not seated.");
    if (!this.hand || this.hand.toActSeat !== seat.seat) {
      return this._error(conn, "It is not your turn.");
    }
    if (!action || typeof action.type !== "string") {
      return this._error(conn, "Malformed action.");
    }
    try {
      this._commitAction(seat.seat, action);
    } catch (err) {
      // Illegal action: toast + re-prompt the same actor (clock untouched).
      this._error(conn, err?.message || "Illegal action.");
      this.sendTurnTo(seat);
      return;
    }
    await this.promptActor();
  }

  async autoAct() {
    if (!this.hand || this.hand.toActSeat === null) return;
    const seatNo = this.hand.toActSeat;
    const menu = legalActions(this.hand);
    // Check if legal, else fold — same path as a real action so completion
    // and side-pots stay correct.
    const action =
      menu.actions.find((a) => a.type === "check") || { type: "fold" };
    try {
      this._commitAction(seatNo, action);
    } catch {
      return;
    }
    await this.promptActor();
  }

  // Apply one action to the engine and mirror it onto seats. May throw.
  _commitAction(seatNo, action) {
    const { state } = applyAction(this.hand, {
      seat: seatNo,
      type: action.type,
      amount: action.amount
    });
    this.hand = state;
    this.syncSeatsFromHand();
    this.setLastAction(seatNo, action);
    this.clearActionTimer();
  }

  syncSeatsFromHand() {
    if (!this.hand) return;
    for (const p of this.hand.players) {
      const s = this.seats.get(p.seat);
      if (!s) continue;
      s.status = p.status;
      s.committedThisStreet = p.committedThisStreet;
      s.totalCommitted = p.totalCommitted;
    }
  }

  setLastAction(seatNo, action) {
    const s = this.seats.get(seatNo);
    if (!s) return;
    let label;
    switch (action.type) {
      case "fold":
        label = "Fold";
        break;
      case "check":
        label = "Check";
        break;
      case "call":
        label = "Call";
        break;
      case "bet":
        label = `Bet ${action.amount}`;
        break;
      case "raise":
        label = `Raise ${action.amount}`;
        break;
      case "allin":
        label = "All-in";
        break;
      default:
        label = null;
    }
    s.lastAction = label;
  }

  buildResult(hand) {
    if (hand.result?.type === "uncontested") {
      return {
        type: "uncontested",
        board: [...hand.board],
        winners: [{ seat: hand.result.winnerSeat, amount: hand.result.amount }],
        revealed: []
      };
    }
    // showdown
    const winners = (hand.payouts || []).map((p) => ({
      seat: p.seat,
      amount: p.amount
    }));
    const revealed = (hand.result?.hands || []).map((h) => ({
      seat: h.seat,
      holeCards: [...h.holeCards],
      handName: h.name
    }));
    return { type: "showdown", board: [...hand.board], winners, revealed };
  }

  async finishHand() {
    const hand = this.hand;
    if (!hand) return;

    // 1. Reconcile stacks + compute net for each dealt seat.
    const persistSeats = [];
    const escrowSnaps = [];
    for (const p of hand.players) {
      const s = this.seats.get(p.seat);
      if (!s) continue;
      const start = s.stackAtHandStart ?? p.stack;
      const net = p.stack - start;
      s.stack = p.stack;
      persistSeats.push({
        userId: s.userId,
        seat: p.seat,
        displayName: s.name,
        holeCards: s.holeCards ? [...s.holeCards] : null,
        net
      });
      escrowSnaps.push({ userId: s.userId, seatNo: p.seat, stack: p.stack });
    }

    // Update the durable escrow mirror to post-hand stacks so a crash refunds
    // actual results, not pre-hand amounts. Bounded retry because a stale
    // mirror means a crash would refund the wrong split; conservation itself
    // still holds regardless (cash-out is escrow-authoritative), so we don't
    // wedge the table if it ultimately fails.
    let synced = false;
    for (let attempt = 0; attempt < 3 && !synced; attempt += 1) {
      try { await this.wallet.syncStacks(this.id, escrowSnaps); synced = true; }
      catch { /* transient DB hiccup — retry */ }
    }
    if (!synced) {
      // Conservation still holds (cash-out is escrow-authoritative); the risk is
      // that a crash before the next sync would refund pre-hand splits. Surface
      // it rather than swallowing silently.
      console.error(`[riverside] table ${this.id}: escrow syncStacks failed after retries; escrow mirror is stale until the next hand`);
    }

    const potTotal = hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);

    // 2. Build the result window snapshot.
    this.result = this.buildResult(hand);
    this.resultBoard = [...hand.board];
    this.resultPots = hand.pots.map((p) => ({ ...p }));
    this.resultPotTotal = potTotal;

    // 3. Persist the completed hand (never let a DB error break gameplay).
    try {
      await this.store.persistHand({
        tableId: this.id,
        handNo: this.handNo,
        buttonSeat: this.buttonSeat,
        board: [...hand.board],
        potTotal,
        startedAt: this._handStartedAt,
        endedAt: this.now(),
        stateJson: JSON.stringify(hand),
        seats: persistSeats
      });
    } catch {
      /* swallow persistence errors */
    }

    // 4. Clear hand-scoped seat fields.
    for (const s of this.seats.values()) {
      s.inHand = false;
      s.holeCards = null;
      s.status = null;
      s.committedThisStreet = 0;
      s.totalCommitted = 0;
      s.lastAction = null;
      s.stackAtHandStart = undefined;
    }

    this.hand = null;
    this.actionDeadline = null;
    this._handStartedAt = null;
    this.clearActionTimer();

    // Broadcast the result (clients show it for ~NEW_HAND_DELAY_MS).
    this.broadcast();

    // 5. Cash out anyone who asked to leave mid-hand.
    for (const s of [...this.seats.values()]) {
      if (s.wantsToLeave) await this.creditAndRemove(s);
    }

    // 6. Any seat still disconnected now the hand's over becomes idle → arm
    // its auto-stand so a table left with only ghosts gets reclaimed. (During
    // the hand these seats had inHand set, so no vacate timer was running.)
    for (const s of this.seats.values()) {
      if (!this.isConnected(s)) this.armVacateTimer(s);
    }

    this.broadcast();
    this.hub?.onTableChanged?.(this); // lobby status -> "waiting"; may be empty
    this.maybeStartHand();
    // If everyone left mid-hand (wantsToLeave) and then disconnected, the
    // table is now empty and nothing else will fire — reclaim it here. We're
    // inside the op-lock, so use the locked variant (tryClose would re-enter
    // _run and deadlock). No-op while any seat/watcher remains.
    await this.hub?.reclaimIfEmptyLocked?.(this);
  }

  // Graceful-shutdown drain: refund every seat's chips to its wallet and clear
  // the table. Runs THROUGH the op-lock (_run) so it can't interleave with an
  // in-flight sit/rebuy/act/finishHand and double-move chips (#3). Cash-out is
  // escrow-authoritative, so each seat is refunded exactly what's escrowed;
  // during a hand that's the last-synced (pre-hand) stack — the abandoned pot
  // returns to its contributors and chips are conserved. Best-effort per seat:
  // on a wallet error the escrow row survives and boot reconciliation refunds
  // it, so chips are never lost.
  cashOutAll() {
    return this._run(() => this._cashOutAll());
  }

  async _cashOutAll() {
    this.clearActionTimer();
    this.clearStartTimer();
    this.hand = null;
    for (const s of [...this.seats.values()]) {
      this.clearVacateTimer(s);
      this.seats.delete(s.seat);
      try {
        await this.wallet.cashOut(this.id, s.seat, s.userId);
      } catch { /* best effort on shutdown; escrow covers a failure */ }
    }
    this._closed = true;
  }

  // ------------------------------------------------------- seating / wallet

  async creditAndRemove(seat) {
    // Re-entrancy guard: if this exact seat is already gone (a concurrent
    // path handled it) do nothing. Belt-and-suspenders with the op-lock
    // against double cash-out (#1).
    if (this.seats.get(seat.seat) !== seat) return;
    // Remove synchronously BEFORE the await so nothing can re-find and
    // re-credit the same stack.
    this.seats.delete(seat.seat);
    this.clearVacateTimer(seat); // seat's leaving — drop any pending auto-stand
    // cashOut is escrow-authoritative + idempotent: a committed-but-unacked
    // cash-out leaves NO escrow row, so a retry credits 0 rather than paying
    // twice. So we RETRY on error instead of assuming failure — a lost COMMIT
    // ack resolves to "already paid, seat stays gone", and only a persistent
    // outage falls through to restoring the seat (chips never lost).
    let result = null;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      try { result = await this.wallet.cashOut(this.id, seat.seat, seat.userId); }
      catch { /* transient / ambiguous — retry */ }
    }
    if (result) {
      if (result.refunded > 0) this.sendChips(seat.userId, result.balance);
      return;
    }
    // Persistent failure: restore the seat (its escrow row survived the rolled-
    // back tx), so chips are never lost. wantsToLeave stays set so finishHand's
    // cashout loop retries at the next hand end; a direct Stand can retry too.
    this.seats.set(seat.seat, seat);
    for (const conn of this.connsForUser(seat.userId)) {
      this._error(conn, "Cash-out failed — you're still seated. Try Stand again.");
    }
  }

  // opts.silent suppresses the user-facing error frames (used by the
  // Quick Play matcher, which retries on a seat-collision and handles its
  // own messaging — so a losing race doesn't flash a "Seat taken" toast).
  sit(conn, seatNo, buyin, opts) {
    return this._run(() => this._sit(conn, seatNo, buyin, opts));
  }

  async _sit(conn, seatNo, buyin, opts = {}) {
    const fail = (msg, code) => { if (!opts.silent) this._error(conn, msg, code); };
    if (!conn.user) return fail("Sign in to play.", "AUTH");
    // This table was reclaimed (emptied + closed) while this op was queued —
    // refuse rather than debit a wallet into a seat on a dead table (#5).
    if (this._closed) return fail("This table has closed.");
    seatNo = Number(seatNo);
    buyin = Number(buyin);

    if (!Number.isInteger(seatNo) || seatNo < 0 || seatNo >= this.config.maxSeats) {
      return fail("No such seat.");
    }
    if (this.seats.has(seatNo)) return fail("Seat taken.");
    if (this.seatForUser(conn.user.id)) {
      return fail("You are already seated.");
    }
    if (
      !Number.isInteger(buyin) ||
      buyin < this.config.minBuyin ||
      buyin > this.config.maxBuyin
    ) {
      return fail("Invalid buy-in amount.");
    }

    let balance;
    try {
      // Atomic: debit the wallet + create this seat's escrow row (= buyin).
      // opts.opId is the client's request-boundary idempotency key (a resend of
      // the same sit resolves rather than double-charging).
      balance = await this.wallet.buyIn(conn.user.id, buyin, this.id, seatNo, opts.opId);
    } catch (err) {
      if (err?.code === "INSUFFICIENT_CHIPS") {
        return fail("Not enough chips.", "INSUFFICIENT_CHIPS");
      }
      return fail(err?.message || "Buy-in failed.");
    }

    this.seats.set(seatNo, {
      seat: seatNo,
      userId: conn.user.id,
      name: conn.user.displayName || conn.user.email || String(conn.user.id),
      stack: buyin,
      sittingOut: false,
      wantsToLeave: false,
      inHand: false,
      holeCards: null,
      status: null,
      committedThisStreet: 0,
      totalCommitted: 0,
      lastAction: null
    });

    this.sendChips(conn.user.id, balance);
    this.broadcast();
    this.maybeStartHand();
  }

  stand(conn) {
    return this._run(() => this._stand(conn));
  }

  async _stand(conn) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat) return;
    if (seat.inHand) {
      // Cash out at hand end so the current hand settles cleanly.
      seat.wantsToLeave = true;
      this.broadcast();
      return;
    }
    await this.creditAndRemove(seat);
    // Only confirm the leave if the seat actually went away; on a cash-out
    // failure creditAndRemove restores it and already sent an error frame, so
    // a TABLE_LEFT here would lie to the client (#5).
    if (this.seats.get(seat.seat) !== seat) {
      conn.send(encode(S2C.TABLE_LEFT, { tableId: this.id }));
    }
    this.broadcast();
    this.maybeStartHand();
  }

  rebuy(conn, amount, opId) {
    return this._run(() => this._rebuy(conn, amount, opId));
  }

  async _rebuy(conn, amount, opId) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat) return this._error(conn, "You are not seated.");
    if (seat.inHand) {
      return this._error(conn, "Can't rebuy during a hand.");
    }
    amount = Number(amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return this._error(conn, "Invalid rebuy amount.");
    }
    if (seat.stack + amount > this.config.maxBuyin) {
      return this._error(conn, "Rebuy would exceed the max buy-in.");
    }

    let res;
    try {
      // Atomic: debit the wallet + add to THIS seat's escrow row (owner-matched).
      // opId is the client's request-boundary idempotency key.
      res = await this.wallet.rebuy(conn.user.id, amount, this.id, seat.seat, opId);
    } catch (err) {
      if (err?.code === "INSUFFICIENT_CHIPS") {
        return this._error(conn, "Not enough chips.", "INSUFFICIENT_CHIPS");
      }
      return this._error(conn, err?.message || "Rebuy failed.");
    }

    // Set from the AUTHORITATIVE escrow stack, not by incrementing, so a resend
    // (same opId) that resolves to the already-applied result can't double-count.
    seat.stack = res.stack;
    this.sendChips(conn.user.id, res.balance);
    this.broadcast();
    this.maybeStartHand();
  }

  setSitOut(conn, sitOut) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat) return;
    seat.sittingOut = !!sitOut;
    // A sitting-out player finishes the current hand but isn't dealt next.
    this.broadcast();
    this.maybeStartHand();
  }

  // ------------------------------------------------------- disconnect

  onConnectionGone(conn) {
    if (!conn.user) return;
    const seat = this.seatForUser(conn.user.id);
    if (!seat) return; // this connection didn't own a seat here

    // Synchronous, and the hub calls removeWatcher() before this, so
    // isConnected() already reflects the dropped socket.
    if (
      this.hand &&
      this.hand.toActSeat === seat.seat &&
      !this.isConnected(seat)
    ) {
      // Shorten the disconnected actor's clock; mark it a grace clock so a
      // reconnect restores a full one (#7).
      seat._graceClock = true;
      this._armActionTimer(DISCONNECT_GRACE_MS);
      this.broadcast();
    } else {
      // Connectivity dropped → let others see it, and eligibility may have
      // changed (they're skipped next hand).
      this.broadcast();
      this.maybeStartHand();
    }

    // A fully-disconnected seat that isn't in a live hand is a candidate to be
    // reclaimed: without this, a lone player who closes the tab (or the last
    // survivors of a table all leaving) would keep an ephemeral table alive
    // forever. Self-guards on inHand (a dealt seat is handled by the shortened
    // action clock above and re-armed at hand end) and on a still-live socket
    // (multi-tab), so this is a no-op unless the seat is truly idle+gone.
    if (!this.isConnected(seat)) this.armVacateTimer(seat);
  }

  // ------------------------------------------------------- seat reclamation

  clearVacateTimer(seat) {
    if (seat && seat._vacateTimer != null) {
      this.clearTimer(seat._vacateTimer);
      seat._vacateTimer = null;
    }
    // Bump the generation so an already-fired, queued vacate callback bails —
    // otherwise a reconnect+disconnect flap could let a stale callback vacate a
    // seat that just started a fresh grace window (#6).
    if (seat) seat._vacateGen = (seat._vacateGen || 0) + 1;
  }

  // Arm a grace timer to auto-stand a seat whose owner has no live connection.
  // On fire (if they haven't reconnected) their chips return to the wallet,
  // the seat is freed, and — if that empties the table — the hub tears the
  // ephemeral table down. Only meaningful for an idle, disconnected seat; a
  // dealt seat is left to the action clock and re-armed by finishHand.
  armVacateTimer(seat) {
    if (!seat || seat.inHand) return;
    if (seat._vacateTimer != null) return; // already counting down
    if (this.isConnected(seat)) return; // a tab is still open
    const gen = (seat._vacateGen = (seat._vacateGen || 0) + 1);
    seat._vacateTimer = this.setTimer(() => {
      seat._vacateTimer = null;
      return this._run(() => {
        if (seat._vacateGen !== gen) return; // reconnect/re-arm superseded us
        return this.vacateSeat(seat);
      });
    }, SEAT_VACATE_GRACE_MS);
  }

  async vacateSeat(seat) {
    // Re-validate under the op-lock: same seat, still gone, still idle.
    if (this.seats.get(seat.seat) !== seat) return; // already left
    if (this.isConnected(seat)) return; // reconnected in the grace window
    if (seat.inHand) { seat.wantsToLeave = true; return; } // settle at hand end
    await this.creditAndRemove(seat);
    // creditAndRemove restores the seat if the wallet credit failed. If it's
    // still here, the cash-out didn't happen — re-arm rather than strand a
    // ghost seat/table forever (#5).
    if (this.seats.get(seat.seat) === seat) {
      this.armVacateTimer(seat);
      return;
    }
    this.broadcast();
    this.hub?.onTableChanged?.(this); // refresh lobby seat counts
    // We're inside the op-lock; use the locked reclaim (tryClose would re-enter
    // _run and deadlock).
    await this.hub?.reclaimIfEmptyLocked?.(this);
  }

  // ------------------------------------------------------- lifecycle close

  // Mark this table closed IFF it's truly empty. Callers that already hold the
  // op-lock (finishHand, vacateSeat, via hub.reclaimIfEmptyLocked) use this
  // directly. Synchronous: no await, so it's atomic w.r.t. the event loop.
  markClosedIfEmpty() {
    if (this._closed) return true;
    if (this.seats.size === 0 && this.watchers.size === 0 && !this.hand && !this._spawning) {
      this._closed = true;
      return true;
    }
    return false;
  }

  // Same check but serialized behind any in-flight op, for callers NOT holding
  // the op-lock (hub.maybeCloseTable). A pending sit finishes first, so we can't
  // close a table out from under a buy-in that's mid-flight (#5).
  tryClose() {
    return this._run(() => this.markClosedIfEmpty());
  }
}
