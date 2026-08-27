// SprintPool — the live fast-fold engine behind the River Sprint. It runs a set
// of persistent tournament-mode tables and moves players between them Zoom-style:
// the instant a player FOLDS they're plucked off their table and re-seated at a
// fresh one from a waiting pool, so nobody waits out a hand they've left. A clock
// ends the round; final chip stacks become the ranked standings the lifecycle
// (sprint.finishRound) turns into payouts.
//
// Integration (see the engine map):
//   * Tables are `tournament:true` LiveTables — T-chip stacks, no wallet/escrow,
//     auto-hidden from the public lobby. Chips enter/leave the economy once, in
//     sprint.js (bid on register, prize on finish); the pool itself never touches
//     wallets.
//   * Each table's `.tournament` back-pointer is set to THIS pool, so the engine's
//     existing per-hand seam (`table.tournament.onHandEnd`) drives bust handling,
//     and the new `hub.onSeatFold -> table.tournament.onSeatFold` hook drives the
//     instant re-seat.
//   * All seat mutations that need the op-lock (sit/pluck) are DEFERRED off the
//     lock (we're notified from inside it), then serialized normally.

import { LiveTable } from "./table.js";
import { encode, S2C } from "../../poker/protocol.js";
import { rankStandings } from "../sprint-core.js";
import { roundHumans } from "../sprint.js";

export class SprintPool {
  constructor(hub, opts = {}) {
    this.hub = hub;
    this.roundId = opts.roundId || "sprint";
    this.variant = opts.variant || "holdem";
    this.maxSeats = opts.maxSeats || 6;
    this.startingStack = opts.startingStack || 1500;
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind = opts.bigBlind || 20;
    this.durationMs = opts.durationMs || 15 * 60 * 1000;

    this.now = opts.now || (() => Date.now());
    this.defer = opts.defer || ((fn) => { const t = setTimeout(fn, 0); t.unref?.(); return t; });
    this.setTimer = opts.setTimeout || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });

    this.tables = [];                 // LiveTable[]
    this.players = new Map();         // userId -> { userId, isHuman, stack, busted, bustAt, seated }
    this.botConns = new Map();        // userId -> BotConn
    this.humanIds = new Set();        // human userIds (conns resolved fresh from the hub)
    this.queue = [];                  // userIds waiting for a seat
    this._running = false;
    this._resolve = null;
    this._clock = null;
    this._pumpScheduled = false;
  }

  // ---- setup -------------------------------------------------------------

  _makeTable(i) {
    const id = `sprint-${this.roundId}-${i}`;
    const table = new LiveTable(
      { id, name: `River Sprint ${i + 1}`, variant: this.variant, max_seats: this.maxSeats,
        small_blind: this.smallBlind, big_blind: this.bigBlind, min_buyin: 1, max_buyin: this.startingStack,
        tournament: true },
      this.hub
    );
    table.tournament = this; // route onHandEnd + onSeatFold back here
    this.hub.tables.set(id, table);
    this.tables.push(table);
    return table;
  }

  addHuman(userId) {
    this.players.set(userId, { userId, isHuman: true, stack: this.startingStack, busted: false, bustAt: 0, seated: false });
    this.humanIds.add(userId);
    this.queue.push(userId);
  }

  // ---- run ---------------------------------------------------------------

  // Seat everyone across freshly-made tables, start the clock, and resolve with
  // the final standings when the buzzer fires.
  async run({ botCount = 0 } = {}) {
    const total = this.players.size + botCount;
    const tableCount = Math.max(1, Math.ceil(total / this.maxSeats));
    for (let i = 0; i < tableCount; i++) this._makeTable(i);

    if (botCount > 0) {
      const bots = await this.hub.botManager.makeBots(this.tables[0], botCount, "reg");
      for (const b of bots) {
        this.players.set(b.user.id, { userId: b.user.id, isHuman: false, stack: this.startingStack, busted: false, bustAt: 0, seated: false });
        this.botConns.set(b.user.id, b);
        this.queue.push(b.user.id);
      }
    }

    this._running = true;
    this._clock = this.setTimer(() => this._buzzer(), this.durationMs);
    const done = new Promise((resolve) => { this._resolve = resolve; });
    await this._pump();
    return done;
  }

  // ---- seating / matchmaking --------------------------------------------

  _openSeat(table) {
    for (let s = 0; s < this.maxSeats; s++) if (!table.seats.has(s)) return s;
    return -1;
  }

  _activePlayers() {
    return [...this.players.values()].filter((p) => !p.busted);
  }

  async _seatPlayer(uid, table) {
    const p = this.players.get(uid);
    if (!p || p.busted) return false;
    const seatNo = this._openSeat(table);
    if (seatNo < 0) return false;
    const stack = p.stack;
    if (p.isHuman) {
      // Resolve the player's LIVE conns fresh (a reconnect since round start would
      // have replaced them). Seat via the first live conn; point ALL of their conns
      // (multi-tab) at the table so the browser actually navigates to the felt.
      const conns = this.hub.connsForUser?.(uid) || [];
      if (!conns.length) return false; // went offline — skip (bid forfeit)
      const conn = conns[0];
      table.addWatcher(conn);
      await table.sit(conn, seatNo, stack, { tournament: true, silent: true });
      // Point every one of the player's tabs at the new table — but only when it
      // actually changed, so a re-pump can't spam redundant navigations.
      if (p.navTable !== table.id) {
        p.navTable = table.id;
        for (const c of conns) { try { c.send(encode(S2C.TABLE_CREATED, { tableId: table.id })); } catch { /* dead conn */ } }
      }
    } else {
      const bot = this.botConns.get(uid);
      if (!bot) return false;
      for (const t of this.tables) if (t.id !== table.id) t.removeWatcher?.(bot);
      bot.rebind(table);
      table.addWatcher(bot);
      await table.sit(bot, seatNo, stack, { tournament: true, silent: true });
    }
    p.seated = true;
    p.tableId = table.id;
    return true;
  }

  // Matchmaker: pull lone/idle players into the queue, then fill tables to >=2 so
  // hands can run. Debounced so bursts of folds coalesce into one pass. Ends the
  // round early if the field has collapsed to a single survivor.
  _pump() {
    if (this._pumpScheduled) return Promise.resolve();
    this._pumpScheduled = true;
    return new Promise((resolve) => {
      this.defer(async () => {
        this._pumpScheduled = false;
        if (!this._running) return resolve();
        try { await this._doPump(); } catch { /* keep the round alive */ }
        resolve();
      });
    });
  }

  async _doPump() {
    // Collapse to a winner? End early.
    const active = this._activePlayers();
    if (active.length <= 1) { this._buzzer(); return; }

    // Reclaim any player sitting alone at an idle table (can't play heads-down-one).
    for (const t of this.tables) {
      if (t.hand) continue; // a live hand is running — leave it
      const seated = [...t.seats.values()];
      if (seated.length === 1) {
        const snap = await t.pluck(seated[0].userId);
        if (snap) { const p = this.players.get(snap.userId); if (p) { p.stack = snap.stack; p.seated = false; this.queue.push(snap.userId); } }
      }
    }

    // Seat queued players into tables with open seats (prefer filling toward >=2).
    const stillQueued = [];
    for (const uid of this.queue) {
      const p = this.players.get(uid);
      if (!p || p.busted || p.seated) continue;
      // pick the table with the most seated players but still an open seat, else any open, else a table below cap
      const target = this.tables
        .filter((t) => this._openSeat(t) >= 0)
        .sort((a, b) => b.seats.size - a.seats.size)[0];
      if (!target) { stillQueued.push(uid); continue; }
      const ok = await this._seatPlayer(uid, target);
      if (!ok) stillQueued.push(uid);
    }
    this.queue = stillQueued;
  }

  // Minimal tournament-HUD shape the table's publicView expects from a controller.
  view() {
    return {
      id: this.roundId, name: "River Sprint", variant: this.variant, kind: "sprint",
      status: this._running ? "running" : "complete",
      startingStack: this.startingStack, remaining: this._activePlayers().length,
      blinds: { sb: this.smallBlind, bb: this.bigBlind }, players: [],
    };
  }

  // ---- engine hooks (called from the table op-lock — DEFER real work) ----

  // A player folded: pull them to a fresh table immediately.
  onSeatFold(table, seatNo, userId) {
    if (!this._running || !userId) return;
    const p = this.players.get(userId);
    if (!p || p.busted) return;
    this.defer(async () => {
      if (!this._running) return;
      const snap = await table.pluck(userId).catch(() => null);
      if (!snap) return; // couldn't pluck (their turn / still in pot) — catch at hand end
      p.stack = snap.stack; p.seated = false;
      if (!this.queue.includes(userId)) this.queue.push(userId);
      await this._pump();
    });
  }

  // A hand finished on `table` (this.hand is already null here). Remove busts,
  // sync surviving stacks, then re-pump. Runs inside the op-lock: mutate seats
  // directly (like the Tournament controller) and defer anything that needs sit().
  async onHandEnd(table) {
    if (!this._running) return;
    for (const s of [...table.seats.values()]) {
      const p = this.players.get(s.userId);
      if (!p) { table.seats.delete(s.seat); continue; }
      if ((s.stack || 0) <= 0) {
        p.busted = true; p.bustAt = this.now(); p.stack = 0; p.seated = false;
        table.seats.delete(s.seat);
        if (!p.isHuman) { try { this.botConns.get(s.userId)?.detach(); } catch { /* noop */ } }
      } else {
        p.stack = s.stack; // keep the pool's mirror current
      }
    }
    this._pump();
  }

  // ---- finish ------------------------------------------------------------

  _standings() {
    const list = this._activePlayers().map((p) => {
      // Prefer the live seat stack for anyone still seated.
      let stack = p.stack;
      for (const t of this.tables) { const s = t.seatForUser?.(p.userId); if (s) { stack = s.stack; break; } }
      return { id: p.userId, stack: p.busted ? 0 : stack, bustAt: p.bustAt || 0, isHuman: p.isHuman };
    });
    // Include busted players too (they rank below survivors, by bust time).
    for (const p of this.players.values()) {
      if (!p.busted) continue;
      list.push({ id: p.userId, stack: 0, bustAt: p.bustAt || 0, isHuman: p.isHuman });
    }
    return rankStandings(list);
  }

  _buzzer() {
    if (!this._running) return;
    this._running = false;
    if (this._clock) { try { clearTimeout(this._clock); } catch { /* injected */ } this._clock = null; }
    const standings = this._standings();
    // Toast each human their placing and clear their table view so the client
    // routes them off the felt that's about to be torn down.
    const placeById = new Map(standings.map((s) => [s.id, s.place]));
    for (const uid of this.humanIds) {
      const place = placeById.get(uid);
      for (const conn of (this.hub.connsForUser?.(uid) || [])) {
        try {
          conn.send(encode(S2C.TOAST, { level: place === 1 ? "success" : "info", text: `River Sprint over — you finished #${place ?? "?"} of ${standings.length}.` }));
          for (const t of this.tables) conn.send(encode(S2C.TABLE_LEFT, { tableId: t.id }));
        } catch { /* conn gone */ }
      }
    }
    this._teardown();
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(standings); }
  }

  _teardown() {
    for (const t of this.tables) {
      try { t._closed = true; t.clearActionTimer?.(); t.clearStartTimer?.(); } catch { /* noop */ }
      try { this.hub.botManager.detachAll?.(t); } catch { /* noop */ }
      try { this.hub.botManager.forgetTable?.(t.id); } catch { /* noop */ }
      this.hub.tables.delete(t.id);
    }
    for (const b of this.botConns.values()) { try { b.detach(); } catch { /* noop */ } }
  }
}

// A scheduler `runner`: build + play a pool for one round and return the ranked
// standings. Seats the round's registered humans who are ONLINE (an absent
// registrant simply doesn't play — their bid is forfeit, no place, no prize) and
// fills toward `fillTo` with bots for a lively field. Blinds are fixed (a timed
// sprint rewards the chip leader at the buzzer, not the last player standing).
export function makeSprintRunner(hub, { fillTo = 8, maxSeats = 6 } = {}) {
  return async (round) => {
    const humanIds = await roundHumans(round.id);
    const stack = Number(round.starting_stack) || 1500;
    const pool = new SprintPool(hub, {
      roundId: round.id,
      startingStack: stack,
      durationMs: Number(round.duration_ms) || 15 * 60 * 1000,
      smallBlind: Math.max(10, Math.round(stack / 100)),
      bigBlind: Math.max(20, Math.round(stack / 50)),
      maxSeats,
    });
    let seated = 0;
    for (const uid of humanIds) {
      if ((hub.connsForUser?.(uid) || []).length) { pool.addHuman(uid); seated++; }
    }
    let botCount = Math.max(0, fillTo - seated);
    if (seated + botCount < 2) botCount = 2 - seated; // need at least heads-up to play
    return pool.run({ botCount });
  };
}
