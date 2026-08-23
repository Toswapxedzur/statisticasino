// PokerHub — the process-wide singleton owning every live table and every
// connection. PlayOK-style model (v11): tables are player-created and
// ephemeral (no seeding, no DB auto-load); the hub also maintains lobby
// presence (online players), a lobby chat relay, invites, and a chip
// leaderboard. Gameplay routing to LiveTable is unchanged.
//
// Plain-node-ESM clean so it runs under both Vite dev and the prod
// server.js.

import { randomBytes } from "node:crypto";
import { encode, decode, C2S, S2C } from "../../poker/protocol.js";
import {
  createTableRow,
  closeTableRow,
  chipsForUsers,
  leaderboard
} from "./store.js";
import { getBalance } from "../wallet.js";
import { LiveTable } from "./table.js";
import { GameTable } from "./runtime.js";
import { blackjack } from "./games/blackjack.js";
import { VARIANT_KEYS } from "./engine/variants.js";
import { BotManager } from "./bot/manager.js";
import { TIERS } from "./bot/tiers.js";

const INVITE_TTL_MS = 60_000;
const LEADERBOARD_SIZE = 10;

class PokerHub {
  constructor() {
    this.tables = new Map();        // tableId -> LiveTable (in-memory only)
    this.connections = new Set();   // all live connections
    this.lobbySubs = new Set();     // connections subscribed to the lobby
    this.invites = new Map();       // inviteId -> {fromUserId,toUserId,tableId,expiresAt}
    this.userLocks = new Map();     // userId -> in-flight seat-op promise chain
    this._lobbyGen = 0;             // coalesces overlapping lobby snapshots
    this.shuttingDown = false;      // set during a graceful drain (rejects ops)
    this.botManager = new BotManager(); // owns bot identities + seating
  }

  // ------------------------------------------------------- helpers

  _err(conn, msg, code) {
    conn.send(encode(S2C.ERROR, code ? { code, msg } : { msg }));
  }

  // Serialize a user's seat-acquiring ops (create / quick-play / invite /
  // respond) per userId. The per-table op-lock can't coordinate ACROSS tables,
  // so without this two tabs could both pass the "not seated yet" check and end
  // up seated at two different tables (two locked stacks). Chains per user and
  // self-prunes when the last op settles.
  _runForUser(userId, fn) {
    const prev = this.userLocks.get(userId) || Promise.resolve();
    const result = prev.then(() => fn());
    const guard = result.then(() => {}, () => {});
    this.userLocks.set(userId, guard);
    guard.then(() => {
      if (this.userLocks.get(userId) === guard) this.userLocks.delete(userId);
    });
    return result;
  }

  // Drop expired invites. Lazy sweep driven off invite traffic — enough to keep
  // the map bounded (each new invite sweeps first) without a background timer.
  _sweepInvites() {
    const now = Date.now();
    for (const [id, inv] of this.invites) {
      if (now > inv.expiresAt) this.invites.delete(id);
    }
  }

  connsForUser(userId) {
    const out = [];
    for (const c of this.connections) if (c.user && c.user.id === userId) out.push(c);
    return out;
  }

  seatOfUser(userId) {
    for (const t of this.tables.values()) if (t.seatForUser(userId)) return t;
    return null;
  }

  firstOpenSeat(table) {
    for (let i = 0; i < table.config.maxSeats; i += 1) {
      if (!table.seats.has(i)) return i;
    }
    return -1;
  }

  // Ephemeral tables live only in memory; if it isn't here, it's gone.
  async getOrLoadTable(tableId) {
    return this.tables.get(tableId) || null;
  }

  // ------------------------------------------------------- connections

  addConnection(conn) {
    this.connections.add(conn);
    conn.watching = new Set();
    this.pushLobby();
  }

  async removeConnection(conn) {
    this.connections.delete(conn);
    this.lobbySubs.delete(conn);
    const watched = [...(conn.watching ?? [])];
    for (const tableId of watched) {
      const t = this.tables.get(tableId);
      if (t) t.removeWatcher(conn);
    }
    // Seats persist across a disconnect; let the table shorten the clock if
    // the gone conn owned the acting seat.
    for (const t of this.tables.values()) {
      if (typeof t.onConnectionGone === "function") t.onConnectionGone(conn);
    }
    // A table whose last watcher just left (and has no seats) is now empty.
    for (const tableId of watched) {
      const t = this.tables.get(tableId);
      if (t) await this.maybeCloseTable(t);
    }
    await this.pushLobby();
  }

  // ------------------------------------------------------- lobby snapshot

  lobbyTableRow(table) {
    return {
      ...table.lobbyRow(),
      status: table.hand ? "playing" : "waiting",
      createdBy: table.createdBy ?? null,
      creatorName: table.creatorName ?? null
    };
  }

  // Build the full { tables, players, leaderboard } snapshot. Players are
  // deduped by userId; location is the table they're seated at / watching,
  // else "lobby".
  async lobbySnapshot() {
    const tables = [];
    for (const t of this.tables.values()) tables.push(this.lobbyTableRow(t));
    tables.sort((a, b) => (a.smallBlind - b.smallBlind) || a.name.localeCompare(b.name));

    const byUser = new Map();
    for (const conn of this.connections) {
      const u = conn.user;
      if (!u) continue;
      let location = "lobby";
      let tableName = null;
      const seatedAt = this.seatOfUser(u.id);
      if (seatedAt) {
        location = seatedAt.id;
        tableName = seatedAt.config.name;
      } else {
        for (const tid of conn.watching ?? []) {
          const t = this.tables.get(tid);
          if (t) { location = tid; tableName = t.config.name; break; }
        }
      }
      const prev = byUser.get(u.id);
      // Prefer a table location over "lobby" when a user has multiple conns.
      if (!prev || (prev.location === "lobby" && location !== "lobby")) {
        byUser.set(u.id, {
          id: u.id,
          name: u.displayName || u.email,
          isAdmin: !!u.isAdmin,
          location,
          tableName
        });
      }
    }

    const ids = [...byUser.keys()];
    let chips = new Map();
    try { chips = await chipsForUsers(ids); } catch { /* keep zeros */ }
    const players = ids
      .map((id) => ({ ...byUser.get(id), chips: chips.get(id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let lb = [];
    try {
      lb = (await leaderboard(LEADERBOARD_SIZE)).map((r) => ({ name: r.name, chips: Number(r.chips) }));
    } catch { /* leaderboard optional */ }

    return { tables, players, leaderboard: lb };
  }

  async pushLobby() {
    if (this.lobbySubs.size === 0) return;
    // Coalesce overlapping pushes: a snapshot awaits DB queries, and if a newer
    // push started meanwhile the older, now-stale snapshot must not be sent
    // last (it would resurrect a ghost player/table until the next event). Only
    // the most recently started snapshot is delivered (#8).
    const gen = ++this._lobbyGen;
    let snap;
    try { snap = await this.lobbySnapshot(); } catch { return; }
    if (gen !== this._lobbyGen) return; // superseded by a newer push
    const msg = encode(S2C.LOBBY, snap);
    for (const conn of this.lobbySubs) conn.send(msg);
  }

  // Called by LiveTable when a hand starts/ends (status changed).
  onTableChanged() {
    this.pushLobby();
  }

  // Remove a table already determined empty+closed, and its dangling invites.
  // No locking here — the caller made the close decision safely (tryClose /
  // markClosedIfEmpty set table._closed under the op-lock).
  async _reclaim(table) {
    this.tables.delete(table.id);
    this.botManager.forgetTable(table.id); // stop any lingering bot timers/registry
    // Drop any invites that pointed at this now-dead table (#7).
    for (const [id, inv] of this.invites) {
      if (inv.tableId === table.id) this.invites.delete(id);
    }
    try { await closeTableRow(table.id); } catch { /* row stays; harmless */ }
    await this.pushLobby();
  }

  // Tear down an ephemeral table once it is truly empty. For callers NOT
  // holding the table op-lock (removeConnection, TABLE_LEAVE, stand,
  // _spawnTable): tryClose() serializes the emptiness check behind any in-flight
  // sit/stand, so a table can't be closed out from under a pending buy-in (#5).
  // Never closes a table that's mid-spawn (#2).
  async maybeCloseTable(table) {
    if (!table || table._spawning) return;
    // Bots must not keep a table alive on their own: if the last human just
    // left, remove the bots so the table can be reclaimed (they fold out and
    // cash out through the normal path).
    await this.botManager.reapIfNoHumans(table);
    const closed = await table.tryClose?.();
    if (closed) await this._reclaim(table);
  }

  // Same reclaim, for callers that ALREADY hold the op-lock (finishHand,
  // vacateSeat). Uses the synchronous markClosedIfEmpty so it can't re-enter
  // _run and deadlock.
  async reclaimIfEmptyLocked(table) {
    if (!table || table._spawning) return;
    if (table.markClosedIfEmpty?.()) await this._reclaim(table);
  }

  // Graceful shutdown: refund every seated player's chips to their wallet and
  // drop all tables, so a deploy/restart doesn't leave chips locked in memory.
  // Sets `shuttingDown` first so no new mutating op can race the drain (#3);
  // each table's cashOutAll runs through its own op-lock. Wired into server.js
  // signal handlers. (A hard crash still relies on boot escrow reconciliation.)
  async shutdown() {
    this.shuttingDown = true;
    for (const table of [...this.tables.values()]) {
      this.botManager.forgetTable(table.id); // stop bot timers; cashOutAll refunds bot seats
      try { await table.cashOutAll(); } catch { /* best effort */ }
      this.tables.delete(table.id);
      try { await closeTableRow(table.id); } catch { /* row stays; harmless */ }
    }
    this.invites.clear();
  }

  // ------------------------------------------------------- create / quickplay

  _validateTableCfg(cfg) {
    if (cfg.variant === "blackjack") return this._validateBlackjackCfg(cfg);
    const sb = Number(cfg.smallBlind);
    const bb = Number(cfg.bigBlind);
    const maxSeats = Number(cfg.maxSeats);
    const minBuyin = Number(cfg.minBuyin);
    const maxBuyin = Number(cfg.maxBuyin);
    const buyin = Number(cfg.buyin);
    if (![sb, bb, maxSeats, minBuyin, maxBuyin, buyin].every(Number.isInteger)) {
      return { error: "Invalid table settings." };
    }
    if (sb < 1 || bb < sb) return { error: "Blinds must be positive (small ≤ big)." };
    if (maxSeats < 2 || maxSeats > 9) return { error: "Seats must be between 2 and 9." };
    if (minBuyin < bb || minBuyin > maxBuyin) return { error: "Buy-in range is invalid." };
    if (buyin < minBuyin || buyin > maxBuyin) return { error: "Your buy-in is out of range." };
    const variant = cfg.variant || "holdem";
    if (!VARIANT_KEYS.includes(variant)) return { error: "Unknown game variant." };
    return { sb, bb, maxSeats, minBuyin, maxBuyin, buyin, variant, game: "poker" };
  }

  // Blackjack tables reuse the smallBlind column as the table minimum bet and
  // have no big blind. The creator either banks (deep bankroll, may exceed the
  // table max) or plays (a wealthy bot banks). See ensureBlackjackBanker.
  _validateBlackjackCfg(cfg) {
    const minBet = Number(cfg.smallBlind ?? cfg.minBet);
    const maxSeats = Number(cfg.maxSeats);
    const minBuyin = Number(cfg.minBuyin);
    const maxBuyin = Number(cfg.maxBuyin);
    const buyin = Number(cfg.buyin);
    if (![minBet, maxSeats, minBuyin, maxBuyin, buyin].every(Number.isInteger)) {
      return { error: "Invalid table settings." };
    }
    if (minBet < 1) return { error: "Minimum bet must be positive." };
    if (maxSeats < 2 || maxSeats > 7) return { error: "Seats must be between 2 and 7." };
    if (minBuyin < minBet || minBuyin > maxBuyin) return { error: "Buy-in range is invalid." };
    const beBanker = !!cfg.beBanker;
    if (buyin < minBuyin) return { error: "Your buy-in is too small." };
    if (!beBanker && buyin > maxBuyin) return { error: "Your buy-in is out of range." };
    return {
      game: "blackjack", variant: "blackjack",
      sb: minBet, bb: minBet, maxSeats, minBuyin, maxBuyin, buyin, beBanker
    };
  }

  // Default buy-in: requested (clamped) else ~100 big blinds, bounded by the
  // table's range and the player's wallet. Returns null if they can't afford
  // the minimum.
  _defaultBuyin(cfg, wallet, requested) {
    if (wallet < cfg.minBuyin) return null;
    let b = requested != null ? Number(requested) : Math.min(cfg.maxBuyin, cfg.bigBlind * 100);
    if (!Number.isInteger(b)) return null;
    b = Math.min(b, cfg.maxBuyin, wallet);
    b = Math.max(b, cfg.minBuyin);
    if (b > wallet) return null;
    return b;
  }

  // Create a table row + live instance, seat the creator, and tell them to
  // navigate. Returns the table, or null if it couldn't seat (rolled back).
  async _spawnTable(conn, cfg, buyin) {
    const name = (cfg.name && String(cfg.name).trim().slice(0, 40))
      || `${conn.user.displayName || conn.user.email}'s Table`;
    const rowCfg = {
      name,
      variant: cfg.variant || "holdem",
      maxSeats: cfg.maxSeats,
      smallBlind: cfg.smallBlind ?? cfg.sb,
      bigBlind: cfg.bigBlind ?? cfg.bb,
      minBuyin: cfg.minBuyin,
      maxBuyin: cfg.maxBuyin
    };
    const tid = await createTableRow(rowCfg, conn.user.id);
    const liveConfig = {
      id: tid,
      name: rowCfg.name,
      variant: rowCfg.variant,
      max_seats: rowCfg.maxSeats,
      small_blind: rowCfg.smallBlind,
      big_blind: rowCfg.bigBlind,
      min_buyin: rowCfg.minBuyin,
      max_buyin: rowCfg.maxBuyin
    };
    const isBlackjack = cfg.game === "blackjack";
    const table = isBlackjack
      ? new GameTable(liveConfig, this, { game: blackjack, gameConfig: { minBet: rowCfg.smallBlind } })
      : new LiveTable(liveConfig, this);
    table.createdBy = conn.user.id;
    table.creatorName = conn.user.displayName || conn.user.email;
    table._spawning = true; // shield from teardown while the buy-in is in flight
    this.tables.set(tid, table);

    table.addWatcher(conn);
    if (isBlackjack) {
      await this._seatBlackjackCreator(conn, table, cfg, buyin);
    } else {
      await table.sit(conn, this.firstOpenSeat(table), buyin);
    }
    table._spawning = false;
    if (!table.seatForUser(conn.user.id)) {
      // Buy-in failed (sit already errored) — roll the table back.
      this.tables.delete(tid);
      try { await closeTableRow(tid); } catch { /* noop */ }
      return null;
    }
    // If the creator's socket dropped DURING the buy-in await, their seat is now
    // idle+disconnected and removeConnection already ran (before the seat
    // existed, so it did nothing). Kick the vacate path now and reclaim if the
    // table is empty, so an interrupted create can't strand a debit (#2).
    if (!this.connections.has(conn)) {
      table.onConnectionGone(conn);
      await this.maybeCloseTable(table);
    }
    conn.send(encode(S2C.TABLE_CREATED, { tableId: tid }));
    await this.pushLobby();
    return table;
  }

  // Seat the creator of a blackjack table: either as the banker (deep bankroll,
  // may exceed the table max), or as a player with a wealthy bot banking.
  async _seatBlackjackCreator(conn, table, cfg, buyin) {
    if (cfg.beBanker) {
      await table.sit(conn, this.firstOpenSeat(table), buyin, { asBanker: true });
      const seat = table.seatForUser(conn.user.id);
      if (seat) table.bankerSeat = seat.seat;
      return;
    }
    // A wealthy bot hosts; the creator plays.
    await this.botManager.attachBanker(table);
    await table.sit(conn, this.firstOpenSeat(table), buyin);
  }

  // A banked table needs a banker. If it has none (creator chose not to bank, or
  // a human banker left) but has players, seat a wealthy bot as the house.
  async ensureBlackjackBanker(table) {
    if (!(table instanceof GameTable) || !table.game.usesBanker) return;
    const haveBanker = table.bankerSeat != null && table.seats.has(table.bankerSeat);
    const players = [...table.seats.values()].filter((s) => s.seat !== table.bankerSeat);
    if (!haveBanker && players.length > 0 && table.seats.size < table.config.maxSeats) {
      await this.botManager.attachBanker(table);
      await this.pushLobby();
    }
  }

  createTable(conn, cfg) {
    if (!conn.user) return this._err(conn, "Sign in to create a table.", "AUTH");
    return this._runForUser(conn.user.id, () => this._createTable(conn, cfg));
  }

  async _createTable(conn, cfg) {
    const v = this._validateTableCfg(cfg);
    if (v.error) return this._err(conn, v.error);
    const bal = await getBalance(conn.user.id);
    if (bal < v.buyin) return this._err(conn, "Not enough chips for that buy-in.", "INSUFFICIENT_CHIPS");
    await this._spawnTable(
      conn,
      { name: cfg.name, game: v.game, variant: v.variant, beBanker: v.beBanker, maxSeats: v.maxSeats, smallBlind: v.sb, bigBlind: v.bb, minBuyin: v.minBuyin, maxBuyin: v.maxBuyin },
      v.buyin
    );
  }

  quickPlay(conn, opts = {}) {
    if (!conn.user) return this._err(conn, "Sign in to play.", "AUTH");
    return this._runForUser(conn.user.id, () => this._quickPlay(conn, opts));
  }

  async _quickPlay(conn, opts = {}) {
    // Already seated somewhere → just send them back to it.
    const existing = this.seatOfUser(conn.user.id);
    if (existing) {
      conn.send(encode(S2C.TABLE_CREATED, { tableId: existing.id }));
      return;
    }

    const wallet = await getBalance(conn.user.id);

    // Pick the best OPEN table this user can afford and isn't already at:
    // prefer a 1-seat table (instant heads-up), else the fullest non-full.
    const bestOpen = () => {
      const open = [...this.tables.values()].filter(
        (t) => t.seats.size < t.config.maxSeats
          && !t.seatForUser(conn.user.id)
          && this._defaultBuyin(t.config, wallet, opts.buyin) != null
      );
      const heads = open.filter((t) => t.seats.size === 1);
      const pool = heads.length ? heads : open;
      pool.sort((a, b) => b.seats.size - a.seats.size);
      return pool[0] || null;
    };

    // Retry on a seat-collision race (two quick-plays grabbing the same seat
    // at once): re-pick the best target + a fresh open seat each attempt.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const target = bestOpen();
      if (!target) break;
      const seat = this.firstOpenSeat(target);
      if (seat < 0) continue;
      const buyin = this._defaultBuyin(target.config, wallet, opts.buyin);
      target.addWatcher(conn);
      await target.sit(conn, seat, buyin, { silent: true });
      if (target.seatForUser(conn.user.id)) {
        conn.send(encode(S2C.TABLE_CREATED, { tableId: target.id }));
        await this.pushLobby();
        return;
      }
      // sit failed (seat taken by a racing quick-play) — loop and re-pick.
    }

    // No open table we can afford — create a default one and seat them.
    const def = { maxSeats: 6, smallBlind: 1, bigBlind: 2, minBuyin: 40, maxBuyin: 200 };
    const buyin = this._defaultBuyin(def, wallet, opts.buyin);
    if (buyin == null) return this._err(conn, "Not enough chips (need at least 40).", "INSUFFICIENT_CHIPS");
    await this._spawnTable(conn, def, buyin);
  }

  // ------------------------------------------------------- invites

  invite(conn, toUserId) {
    if (!conn.user) return this._err(conn, "Sign in first.", "AUTH");
    return this._runForUser(conn.user.id, () => this._invite(conn, toUserId));
  }

  async _invite(conn, toUserId) {
    this._sweepInvites();
    if (!toUserId || toUserId === conn.user.id) return this._err(conn, "Pick another player.");
    const targets = this.connsForUser(toUserId);
    if (targets.length === 0) return this._err(conn, "That player is offline.");

    // Invite goes to the table the inviter is seated at. If they're not
    // seated (challenging straight from the lobby), spawn a heads-up table
    // for them first so the invite has somewhere to point.
    let table = this.seatOfUser(conn.user.id);
    if (!table) {
      const wallet = await getBalance(conn.user.id);
      const def = { maxSeats: 2, smallBlind: 1, bigBlind: 2, minBuyin: 40, maxBuyin: 200 };
      const buyin = this._defaultBuyin(def, wallet, null);
      if (buyin == null) return this._err(conn, "Not enough chips to start a table.", "INSUFFICIENT_CHIPS");
      table = await this._spawnTable(conn, def, buyin);
      if (!table) return; // spawn failed (already errored)
    } else if (table.seats.size >= table.config.maxSeats) {
      return this._err(conn, "Your table is full.");
    }

    const inviteId = randomBytes(9).toString("hex");
    this.invites.set(inviteId, {
      fromUserId: conn.user.id,
      toUserId,
      tableId: table.id,
      expiresAt: Date.now() + INVITE_TTL_MS
    });
    const payload = encode(S2C.INVITE, {
      inviteId,
      fromName: conn.user.displayName || conn.user.email,
      fromUserId: conn.user.id,
      tableId: table.id,
      tableName: table.config.name
    });
    for (const c of targets) c.send(payload);
    conn.send(encode(S2C.TOAST, { level: "info", text: "Invite sent." }));
  }

  respondInvite(conn, inviteId, accept) {
    if (!conn.user) return;
    return this._runForUser(conn.user.id, () => this._respondInvite(conn, inviteId, accept));
  }

  async _respondInvite(conn, inviteId, accept) {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.toUserId !== conn.user?.id) return;
    this.invites.delete(inviteId);
    const inviterConns = this.connsForUser(inv.fromUserId);
    if (Date.now() > inv.expiresAt) {
      return this._err(conn, "That invite expired.");
    }
    if (!accept) {
      for (const c of inviterConns) c.send(encode(S2C.TOAST, { level: "info", text: "Invite declined." }));
      return;
    }
    const table = this.tables.get(inv.tableId);
    if (!table) return this._err(conn, "That table no longer exists.");
    if (table.seatForUser(conn.user.id)) {
      conn.send(encode(S2C.TABLE_CREATED, { tableId: table.id }));
      return;
    }
    if (table.seats.size >= table.config.maxSeats) return this._err(conn, "That table is now full.");
    const wallet = await getBalance(conn.user.id);
    const buyin = this._defaultBuyin(table.config, wallet, null);
    if (buyin == null) return this._err(conn, "Not enough chips to join.", "INSUFFICIENT_CHIPS");
    table.addWatcher(conn);
    await table.sit(conn, this.firstOpenSeat(table), buyin);
    if (table.seatForUser(conn.user.id)) {
      conn.send(encode(S2C.TABLE_CREATED, { tableId: table.id }));
      for (const c of inviterConns) c.send(encode(S2C.TOAST, { level: "info", text: "Invite accepted." }));
      await this.pushLobby();
    }
  }

  // ------------------------------------------------------- message routing

  async handleMessage(conn, raw) {
    const msg = decode(raw);
    if (!msg) return;
    // During a graceful drain, stop accepting new work so nothing races the
    // shutdown cash-out (#3).
    if (this.shuttingDown) return;

    try {
      switch (msg.t) {
        case C2S.HELLO:
          conn.send(encode(S2C.HELLO_OK, {
            user: conn.user
              ? { id: conn.user.id, name: conn.user.displayName || conn.user.email, isAdmin: conn.user.isAdmin }
              : null
          }));
          break;

        case C2S.LOBBY_SUB: {
          this.lobbySubs.add(conn);
          const snap = await this.lobbySnapshot();
          conn.send(encode(S2C.LOBBY, snap));
          break;
        }
        case C2S.LOBBY_UNSUB:
          this.lobbySubs.delete(conn);
          break;

        case C2S.TABLE_JOIN: {
          const t = await this.getOrLoadTable(msg.tableId);
          if (!t) return conn.send(encode(S2C.ERROR, { msg: "That table has closed." }));
          t.addWatcher(conn);
          await this.pushLobby();
          break;
        }
        case C2S.TABLE_LEAVE: {
          const t = this.tables.get(msg.tableId);
          if (t) { t.removeWatcher(conn); await this.maybeCloseTable(t); }
          conn.send(encode(S2C.TABLE_LEFT, { tableId: msg.tableId }));
          await this.pushLobby();
          break;
        }

        // ---- lobby actions (require auth) ----
        case C2S.TABLE_CREATE:
          if (!conn.user) return this._err(conn, "Sign in to create a table.", "AUTH");
          await this.createTable(conn, msg);
          break;
        case C2S.QUICK_PLAY:
          if (!conn.user) return this._err(conn, "Sign in to play.", "AUTH");
          await this.quickPlay(conn, msg);
          break;
        case C2S.LOBBY_CHAT:
          if (!conn.user) return this._err(conn, "Sign in to chat.", "AUTH");
          this.relayLobbyChat(conn, msg.text);
          break;
        case C2S.INVITE:
          if (!conn.user) return this._err(conn, "Sign in first.", "AUTH");
          await this.invite(conn, msg.toUserId);
          break;
        case C2S.INVITE_RESPOND:
          if (!conn.user) return;
          await this.respondInvite(conn, msg.inviteId, msg.accept);
          break;

        // ---- table gameplay (require auth) ----
        case C2S.TABLE_SIT:
        case C2S.TABLE_STAND:
        case C2S.TABLE_ACTION:
        case C2S.TABLE_REBUY:
        case C2S.TABLE_SITOUT:
        case C2S.TABLE_ADD_BOT:
        case C2S.TABLE_REMOVE_BOT:
        case C2S.CHAT: {
          if (!conn.user) return this._err(conn, "Sign in to play.", "AUTH");
          const t = await this.getOrLoadTable(msg.tableId);
          if (!t) return conn.send(encode(S2C.ERROR, { msg: "That table has closed." }));
          await this.routeTableAction(conn, t, msg);
          break;
        }

        case C2S.PONG:
          conn.alive = true;
          break;

        default:
          conn.send(encode(S2C.ERROR, { msg: `Unknown message: ${msg.t}` }));
      }
    } catch (err) {
      conn.send(encode(S2C.ERROR, { msg: err?.message || "Server error." }));
    }
  }

  async routeTableAction(conn, table, msg) {
    switch (msg.t) {
      case C2S.TABLE_SIT:
        await table.sit(conn, msg.seat, msg.buyin, { opId: msg.opId });
        await this.ensureBlackjackBanker(table); // a banked table needs a house
        await this.pushLobby();
        break;
      case C2S.TABLE_STAND:
        await table.stand(conn);
        await this.pushLobby();
        await this.maybeCloseTable(table);
        break;
      case C2S.TABLE_ACTION:
        await table.act(conn, msg.action);
        break;
      case C2S.TABLE_REBUY:
        await table.rebuy(conn, msg.amount, msg.opId);
        await this.pushLobby();
        break;
      case C2S.TABLE_SITOUT:
        table.setSitOut(conn, !!msg.sitOut);
        await this.pushLobby();
        break;
      case C2S.TABLE_ADD_BOT:
        await this.addBot(conn, table, msg.tier, msg.seat);
        break;
      case C2S.TABLE_REMOVE_BOT:
        await this.removeBot(conn, table, msg.seat);
        break;
      case C2S.CHAT:
        this.relayChat(table, conn, msg.text);
        break;
    }
  }

  // Add a bot to `table`. Only a player seated at the table may add one, and
  // only to an open seat. Tier defaults to "reg".
  async addBot(conn, table, tierKey, seat) {
    if (!table.seatForUser(conn.user.id)) {
      return this._err(conn, "Only a seated player can add a bot.");
    }
    const tier = TIERS[tierKey] ? tierKey : "reg";
    const bot = await this.botManager.attach(table, tier, seat != null ? { seat } : {});
    if (!bot) {
      return this._err(conn, "Couldn't seat a bot (table full or none available).");
    }
    await this.pushLobby();
  }

  // Remove the bot seated at `seat`. Only a seated player may remove one, and
  // only an actual bot seat.
  async removeBot(conn, table, seat) {
    if (!table.seatForUser(conn.user.id)) {
      return this._err(conn, "Only a seated player can remove a bot.");
    }
    const s = table.seats.get(Number(seat));
    if (!s || !this.botManager.isBotUser(s.userId)) {
      return this._err(conn, "That seat isn't a bot.");
    }
    const botConn = this.botManager.botsAtTable(table.id).find((b) => b.user.id === s.userId);
    if (!botConn) return this._err(conn, "That bot is no longer here.");
    await this.botManager.detach(table, botConn);
    await this.pushLobby();
    await this.maybeCloseTable(table);
  }

  relayChat(table, conn, text) {
    const clean = String(text || "").slice(0, 300).trim();
    if (!clean) return;
    const out = encode(S2C.CHAT, {
      tableId: table.id,
      from: conn.user.displayName || conn.user.email,
      text: clean,
      ts: Date.now()
    });
    for (const w of table.watchers) w.send(out);
  }

  relayLobbyChat(conn, text) {
    const clean = String(text || "").slice(0, 300).trim();
    if (!clean) return;
    const out = encode(S2C.LOBBY_CHAT, {
      from: conn.user.displayName || conn.user.email,
      text: clean,
      ts: Date.now()
    });
    for (const c of this.lobbySubs) c.send(out);
  }
}

// Process-wide singleton (survives HMR in dev via globalThis).
const g = globalThis;
export const hub = g.__pokerHub__ || (g.__pokerHub__ = new PokerHub());
