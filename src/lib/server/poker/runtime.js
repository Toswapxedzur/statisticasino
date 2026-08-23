// GameTable — a generic real-time table runtime for pluggable GameModules
// (Blackjack today; poker could migrate here later). It reuses LiveTable's
// battle-tested seat/escrow/clock/vacate/op-lock machinery by EXTENDING it, and
// overrides only the round-lifecycle methods to delegate to a GameModule
// (see games/blackjack.js). LiveTable itself is untouched, so the poker path
// keeps all its guarantees; this class inherits the same escrow-authoritative,
// crash-safe money handling.
//
// A GameModule is a pure state machine in the poker-engine shape:
//   startRound(ctx) -> state          legalActions(state) -> {toActSeat, actions}
//   applyAction(state, action) -> {state, events}   isComplete(state) -> bool
//   actorSeat(state) -> seat|null     defaultAction(state, seat) -> action
//   settle(state) -> [{seat, delta}]  (deltas sum to zero; banker absorbs)
//   publicView(state) / privateFor(state, seat) / turnInfo(state, seat)
//   deck() -> string[]   minPlayers   usesBanker
//
// "Banked" games (usesBanker) need one seat flagged as the banker (the house):
// it is dealt against but never acts, and absorbs the net of every player's
// win/loss so chips stay conserved.

import { encode, S2C } from "../../poker/protocol.js";
import { shuffle } from "./engine/index.js";
import { LiveTable, ACTION_TIMEOUT_MS, DISCONNECT_GRACE_MS } from "./table.js";

export class GameTable extends LiveTable {
  constructor(config, hub, deps = {}) {
    super(config, hub, deps);
    if (!deps.game) throw new Error("GameTable requires a game module");
    this.game = deps.game;
    // Per-table game config (e.g. blackjack minBet); the table's smallBlind
    // column doubles as the minimum bet for banked games.
    this.gameConfig = { minBet: this.config.smallBlind, ...(deps.gameConfig || {}) };
    this.bankerSeat = null; // set when a banker sits (usesBanker games)
  }

  // Enough to start: (banked) a funded, connected banker + minPlayers others;
  // (non-banked) minPlayers eligible seats.
  _canStartRound() {
    if (this.game.usesBanker) {
      const banker = this.bankerSeat != null ? this.seats.get(this.bankerSeat) : null;
      if (!banker || !this.isConnected(banker) || banker.stack < 1) return false;
      const others = this.eligibleSeats().filter((s) => s.seat !== this.bankerSeat);
      return others.length >= this.game.minPlayers;
    }
    return this.eligibleSeats().length >= Math.max(2, this.game.minPlayers);
  }

  // Overrides maybeStartHand's gate so the inherited scheduler only fires when a
  // round can actually begin. (maybeStartHand checks eligibleSeats().length >= 2,
  // which we keep, but beginHand re-checks _canStartRound for the banker rule.)
  async beginHand() {
    if (this.hand) return;
    this.clearStartTimer();
    if (!this._canStartRound()) return;

    let handNo;
    try { handNo = await this.store.nextHandNo(this.id); } catch { return; }
    if (this.hand || !_stillStartable(this)) return;

    const roundSeats = [];
    for (const s of this.eligibleSeats()) roundSeats.push({ seat: s.seat, userId: s.userId, stack: s.stack });
    if (this.game.usesBanker) {
      const banker = this.seats.get(this.bankerSeat);
      if (banker && !roundSeats.some((r) => r.seat === this.bankerSeat)) {
        roundSeats.push({ seat: banker.seat, userId: banker.userId, stack: banker.stack });
      }
    }
    const deck = shuffle(this.game.deck(this.gameConfig), this.rng);

    let round;
    try {
      round = this.game.startRound({
        players: roundSeats,
        bankerSeat: this.game.usesBanker ? this.bankerSeat : null,
        deck,
        config: this.gameConfig
      });
    } catch { return; }

    this.hand = round;
    this.handNo = handNo;
    this._handStartedAt = this.now();
    this.result = null;

    for (const s of this.seats.values()) { s.inHand = false; s.stackAtHandStart = undefined; s.lastAction = null; }
    for (const r of roundSeats) {
      const s = this.seats.get(r.seat);
      if (s) { s.inHand = true; s.stackAtHandStart = s.stack; }
    }

    this.sendAllPrivates();
    this.broadcast();
    this.hub?.onTableChanged?.(this);
    await this.promptActor();
  }

  async promptActor() {
    if (!this.hand) return;
    if (this.game.isComplete(this.hand) || this.game.actorSeat(this.hand) === null) {
      await this.finishHand();
      return;
    }
    const seatNo = this.game.actorSeat(this.hand);
    const seat = this.seats.get(seatNo);
    const gone = !!(seat && (!this.isConnected(seat) || seat.sittingOut));
    if (seat) seat._graceClock = gone;
    this._armActionTimer(gone ? DISCONNECT_GRACE_MS : ACTION_TIMEOUT_MS);
    this.broadcast();
    if (seat) this.sendTurnTo(seat);
  }

  async _act(conn, action) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat) return this._error(conn, "You are not seated.");
    if (!this.hand || this.game.actorSeat(this.hand) !== seat.seat) {
      return this._error(conn, "It is not your turn.");
    }
    if (!action || typeof action.type !== "string") return this._error(conn, "Malformed action.");
    let next;
    try {
      ({ state: next } = this.game.applyAction(this.hand, { ...action, seat: seat.seat }));
    } catch (err) {
      this._error(conn, err?.message || "Illegal action.");
      this.sendTurnTo(seat);
      return;
    }
    this.hand = next;
    this.clearActionTimer();
    await this.promptActor();
  }

  async autoAct() {
    if (!this.hand) return;
    const seatNo = this.game.actorSeat(this.hand);
    if (seatNo === null) return;
    let next;
    try {
      ({ state: next } = this.game.applyAction(this.hand, this.game.defaultAction(this.hand, seatNo)));
    } catch { return; }
    this.hand = next;
    this.clearActionTimer();
    await this.promptActor();
  }

  async finishHand() {
    const round = this.hand;
    if (!round) return;

    // Apply per-seat deltas (players + banker), which sum to zero, then mirror
    // post-round stacks into escrow so a crash refunds actual results.
    const deltas = this.game.settle(round);
    const escrowSnaps = [];
    for (const d of deltas) {
      const s = this.seats.get(d.seat);
      if (!s) continue;
      s.stack = (s.stackAtHandStart ?? s.stack) + d.delta;
      escrowSnaps.push({ userId: s.userId, seatNo: s.seat, stack: s.stack });
    }
    let synced = false;
    for (let attempt = 0; attempt < 3 && !synced; attempt += 1) {
      try { await this.wallet.syncStacks(this.id, escrowSnaps); synced = true; } catch { /* retry */ }
    }
    if (!synced) {
      console.error(`[riverside] ${this.game.key} table ${this.id}: escrow syncStacks failed; mirror stale until next round`);
    }

    this.result = this.game.publicView(round);
    for (const s of this.seats.values()) {
      s.inHand = false;
      s.stackAtHandStart = undefined;
    }
    // NB: don't sendChips here — that pill is the WALLET balance, which only
    // moves on buy-in / cash-out / rebuy. On-table stacks are shown on the felt
    // via the broadcast below.
    this.hand = null;
    this.actionDeadline = null;
    this._handStartedAt = null;
    this.clearActionTimer();
    this.broadcast();

    for (const s of [...this.seats.values()]) { if (s.wantsToLeave) await this.creditAndRemove(s); }
    for (const s of this.seats.values()) { if (!this.isConnected(s)) this.armVacateTimer(s); }

    this.broadcast();
    this.hub?.onTableChanged?.(this);
    this.maybeStartHand();
    await this.hub?.reclaimIfEmptyLocked?.(this);
  }

  // Generic seat list + the game's own public overlay.
  publicView() {
    const actor = this.hand ? this.game.actorSeat(this.hand) : null;
    const seats = [];
    for (const [seatNo, s] of this.seats) {
      seats.push({
        seat: seatNo,
        userId: s.userId,
        name: s.name,
        stack: s.stack,
        sittingOut: !!s.sittingOut,
        connected: this.isConnected(s),
        inHand: !!s.inHand,
        isBanker: seatNo === this.bankerSeat,
        isToAct: seatNo === actor // clients clear the turn menu when this is false
      });
    }
    seats.sort((a, b) => a.seat - b.seat);
    const round = this.hand ? this.game.publicView(this.hand) : (this.result || null);
    return {
      id: this.id,
      config: this.config,
      game: this.game.key,
      phase: this.hand || this.result ? "running" : "waiting",
      handNo: this.handNo,
      bankerSeat: this.bankerSeat,
      toActSeat: this.hand ? this.game.actorSeat(this.hand) : null,
      actionDeadline: this.hand ? this.actionDeadline : null,
      seats,
      round,
      result: this.result ?? null
    };
  }

  sendTurnTo(seat) {
    if (!this.hand) return;
    const info = this.game.turnInfo(this.hand, seat.seat);
    if (!info) return;
    const msg = encode(S2C.TABLE_TURN, { tableId: this.id, seat: seat.seat, deadline: this.actionDeadline, ...info });
    for (const conn of this.connsForUser(seat.userId)) conn.send(msg);
  }

  sendPrivateTo(conn) {
    const seat = this.seatForUser(conn.user?.id);
    if (!seat || !this.hand) return;
    const priv = this.game.privateFor(this.hand, seat.seat);
    if (priv) conn.send(encode(S2C.TABLE_PRIVATE, { tableId: this.id, seat: seat.seat, ...priv }));
  }

  // When the banker's seat actually leaves, forget it — otherwise a later player
  // taking that seat number would be mistaken for the house. (The hub then seats
  // a fresh bot banker if players remain.)
  async creditAndRemove(seat) {
    const wasBanker = seat.seat === this.bankerSeat;
    await super.creditAndRemove(seat);
    if (wasBanker && this.seats.get(seat.seat) !== seat) this.bankerSeat = null;
  }
}

// beginHand fetched a hand number across an await; re-confirm the table can
// still start (nothing torn it down or started a round meanwhile).
function _stillStartable(table) {
  return !table._closed && !table.hand && table._canStartRound();
}
