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
  leaderboard,
  handsPlayedByUser
} from "./store.js";
import { getBalance } from "../wallet.js";
import { unlock, handAchievements } from "../achievements.js";
import { areFriends } from "../friends.js";
import { sendMessage, markRead } from "../dm.js";
import * as convo from "../conversations.js";
import { isBlocked } from "../moderation.js";
import { getSocialSettings, SOCIAL_DEFAULTS } from "../social-settings.js";
import { createNotification, listNotifications, unreadCount, markRead as markNotifRead } from "../notifications.js";
import { query as dbQuery } from "../db.js";
import { iceConfig } from "../voice.js";
import { LiveTable } from "./table.js";
import { Tournament } from "./tournament.js";
import { GameTable } from "./runtime.js";
import { getGame, isBankedGame } from "./games/registry.js";
import { VARIANT_KEYS } from "./engine/variants.js";
import { BotManager } from "./bot/manager.js";

const INVITE_TTL_MS = 60_000;
const LEADERBOARD_SIZE = 10;

export class PokerHub {
  constructor() {
    this.tables = new Map();        // tableId -> LiveTable (in-memory only)
    this.connections = new Set();   // all live connections
    this.lobbySubs = new Set();     // connections subscribed to the lobby
    this.invites = new Map();       // inviteId -> {fromUserId,toUserId,tableId,expiresAt}
    this.waitlists = new Map();     // tableId -> [{ userId, name, buyin }] FIFO queue
    this.voiceRooms = new Map();    // tableId -> Map<userId, name> in the voice mesh
    this.tournaments = new Map();   // tourneyId -> Tournament (each owns a tourney-mode table)
    this.userLocks = new Map();     // userId -> in-flight seat-op promise chain
    this._lobbyGen = 0;             // coalesces overlapping lobby snapshots
    this.shuttingDown = false;      // set during a graceful drain (rejects ops)
    this.botManager = new BotManager(); // owns bot identities + seating
    this._socialCache = new Map();  // userId -> { val, exp } social-settings cache
    this.calls = new Map();         // callId -> { id, from, to, state, createdAt } out-of-game voice calls
  }

  // Cached read of a user's social prefs (readReceipts / typing / …). Typing
  // events fire often, so we cache for a few seconds; saving prefs invalidates
  // the entry instantly via invalidateSocialSettings() (same process).
  async _socialSettings(userId) {
    const now = Date.now();
    const hit = this._socialCache.get(userId);
    if (hit && hit.exp > now) return hit.val;
    let val;
    try { val = await getSocialSettings(userId); }
    catch { return { ...SOCIAL_DEFAULTS }; } // fail open — everything enabled
    this._socialCache.set(userId, { val, exp: now + 15000 });
    return val;
  }

  invalidateSocialSettings(userId) {
    if (userId) this._socialCache.delete(userId);
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
    // If this was the user's LAST connection, drop them from every waitlist + voice mesh.
    if (conn.user && this.connsForUser(conn.user.id).length === 0) {
      this._forgetWaitlists(conn.user.id);
      this._forgetVoice(conn.user.id);
      this._forgetCalls(conn.user.id);
    }
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
      creatorName: table.creatorName ?? null,
      waiting: this.waitlistFor(table.id).length
    };
  }

  // Build the full { tables, players, leaderboard } snapshot. Players are
  // deduped by userId; location is the table they're seated at / watching,
  // else "lobby".
  async lobbySnapshot() {
    const tables = [];
    // Tournament-mode tables aren't joinable ring games — they surface in the
    // Tournaments section instead, so keep them out of the ring-game list.
    for (const t of this.tables.values()) if (!t.isTournament) tables.push(this.lobbyTableRow(t));
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
    let avatars = new Map();
    try { avatars = await this._usersInfo(ids); } catch { /* names/avatars optional */ }
    const players = ids
      .map((id) => ({ ...byUser.get(id), chips: chips.get(id) ?? 0, avatarMediaId: avatars.get(id)?.avatarMediaId ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let lb = [];
    try {
      lb = (await leaderboard(LEADERBOARD_SIZE)).map((r) => ({ id: r.id, name: r.name, chips: Number(r.chips), avatarMediaId: r.avatarMediaId }));
    } catch { /* leaderboard optional */ }

    return { tables, players, leaderboard: lb, tournaments: this.tournamentRows() };
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
  onTableChanged(table) {
    this.pushLobby();
    // A seat may have opened (a vacate/auto-stand routes through here) — try the
    // waitlist. Fire-and-forget so we never re-enter the table op-lock synchronously.
    if (table) this.processWaitlist(table).then(() => this.pushLobby()).catch(() => {});
  }

  // Retention: award hand-based achievements to the HUMAN seats of a finished
  // hand. Called fire-and-forget from LiveTable.finishHand, so it owns its errors
  // and never affects gameplay. Bots (funder or player) are skipped; a bot AT the
  // table makes the humans' wins count toward "Bot Slayer".
  async onHandComplete(table, { seats, potTotal }) {
    try {
      const rows = seats || [];
      const vsBot = rows.some((s) => s.userId != null && this.botManager.isBotUser(s.userId));
      for (const s of rows) {
        if (s.userId == null || this.botManager.isBotUser(s.userId)) continue; // humans only
        const won = (s.net ?? 0) > 0;
        const handsPlayed = await handsPlayedByUser(s.userId);
        await unlock(s.userId, handAchievements({
          won, vsBot, allInWin: false, potWon: won ? (s.net ?? 0) : 0, handsPlayed
        }));
      }
    } catch { /* achievements are best-effort; never disrupt the table */ }
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
    // Refund every in-flight tournament's entries BEFORE tearing down tables, so a
    // deploy/restart mid-event never eats entrants' chips (tournaments are in-memory
    // and would otherwise vanish with their pool). Money-conserving.
    for (const t of [...this.tournaments.values()]) {
      try { await t.abortRefund(); } catch { /* best effort */ }
    }
    this.tournaments.clear();
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
    if (isBankedGame(cfg.variant)) return this._validateBankedCfg(cfg);
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

  // Banked games (blackjack, casino-holdem, …) reuse the smallBlind column as
  // the table minimum bet and have no big blind. The creator either banks (deep
  // bankroll, may exceed the table max) or plays (a wealthy bot banks). Per-game
  // rule knobs are merged in (blackjack has several; other games use defaults).
  _validateBankedCfg(cfg) {
    const game = cfg.variant;
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
    let rules = {};
    if (game === "blackjack") {
      const decks = [1, 2, 6, 8].includes(Number(cfg.decks)) ? Number(cfg.decks) : 1;
      rules = {
        dealerHitsSoft17: !!cfg.dealerHitsSoft17,
        blackjackPays: cfg.blackjackPays === "6:5" ? "6:5" : "3:2",
        decks,
        surrender: !!cfg.surrender,
        peek: cfg.peek === false ? false : true
      };
    }
    return { game, variant: game, sb: minBet, bb: minBet, maxSeats, minBuyin, maxBuyin, buyin, beBanker, rules, straddle: !!cfg.straddle, runItTwice: !!cfg.runItTwice };
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
      max_buyin: rowCfg.maxBuyin,
      // In-memory only (not persisted to poker_table): straddle/run-it-twice reset
      // to off if the process restarts and rebuilds the row. Fine for ephemeral tables.
      straddle: !!cfg.straddle,
      runItTwice: !!cfg.runItTwice
    };
    const bankedGame = isBankedGame(cfg.game) ? getGame(cfg.game) : null;
    const table = bankedGame
      ? new GameTable(liveConfig, this, { game: bankedGame, gameConfig: { minBet: rowCfg.smallBlind, ...(cfg.rules || {}) } })
      : new LiveTable(liveConfig, this);
    table.createdBy = conn.user.id;
    table.creatorName = conn.user.displayName || conn.user.email;
    table._spawning = true; // shield from teardown while the buy-in is in flight
    this.tables.set(tid, table);

    table.addWatcher(conn);
    if (bankedGame) {
      await this._seatBankedCreator(conn, table, cfg, buyin);
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

  // Seat the creator of a banked table: either as the banker (deep bankroll, may
  // exceed the table max), or as a player with a wealthy bot banking.
  async _seatBankedCreator(conn, table, cfg, buyin) {
    // Player-vs-player GameTable games (shedding: Big Two, Crazy Eights) have no
    // house — just seat the creator as a normal player.
    if (!table.game.usesBanker) {
      await table.sit(conn, this.firstOpenSeat(table), buyin);
      return;
    }
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
  async ensureBanker(table) {
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
      { name: cfg.name, game: v.game, variant: v.variant, beBanker: v.beBanker, rules: v.rules, maxSeats: v.maxSeats, smallBlind: v.sb, bigBlind: v.bb, minBuyin: v.minBuyin, maxBuyin: v.maxBuyin, straddle: v.straddle, runItTwice: v.runItTwice },
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
        case C2S.WAITLIST_JOIN:
        case C2S.WAITLIST_LEAVE:
        case C2S.CHAT: {
          if (!conn.user) return this._err(conn, "Sign in to play.", "AUTH");
          const t = await this.getOrLoadTable(msg.tableId);
          if (!t) return conn.send(encode(S2C.ERROR, { msg: "That table has closed." }));
          await this.routeTableAction(conn, t, msg);
          break;
        }

        case C2S.DM_SEND:
          await this.routeDM(conn, msg);
          break;

        case C2S.DM_READ:
          if (conn.user && msg.withUserId) { try { await markRead(conn.user.id, msg.withUserId); } catch { /* best effort */ } }
          break;

        case C2S.CONV_LIST:
          await this.sendConvList(conn);
          break;
        case C2S.CONV_OPEN:
          await this.convOpen(conn, msg);
          break;
        case C2S.MSG_SEND:
          await this.msgSend(conn, msg);
          break;
        case C2S.MSG_READ:
          await this.msgRead(conn, msg);
          break;
        case C2S.GROUP_CREATE:
          await this.groupCreate(conn, msg);
          break;
        case C2S.GROUP_UPDATE:
          await this.groupUpdate(conn, msg);
          break;
        case C2S.GROUP_MEMBERS:
          await this.groupMembers(conn, msg);
          break;
        case C2S.MSG_DELETE:
          await this.msgDelete(conn, msg);
          break;
        case C2S.TYPING:
          await this.typing(conn, msg);
          break;

        case C2S.VOICE_JOIN:
          await this.voiceJoin(conn, msg.tableId);
          break;
        case C2S.VOICE_LEAVE:
          this.voiceLeave(conn, msg.tableId);
          break;
        case C2S.RTC_SIGNAL:
          this.relaySignal(conn, msg);
          break;

        case C2S.NOTIF_LIST:
          await this.sendNotifList(conn);
          break;
        case C2S.NOTIF_READ:
          await this.notifRead(conn, msg);
          break;

        case C2S.CALL_INVITE:
          await this.callInvite(conn, msg);
          break;
        case C2S.CALL_ACCEPT:
          await this.callAccept(conn, msg);
          break;
        case C2S.CALL_DECLINE:
          this.callDecline(conn, msg);
          break;
        case C2S.CALL_END:
          this.callEnd(conn, msg);
          break;

        case C2S.TOURNEY_CREATE:
          await this.createTournament(conn, msg);
          break;
        case C2S.TOURNEY_REGISTER:
          await this.registerTournament(conn, msg.tourneyId);
          break;
        case C2S.TOURNEY_UNREGISTER:
          await this.unregisterTournament(conn, msg.tourneyId);
          break;
        case C2S.TOURNEY_START:
          await this.startTournament(conn, msg.tourneyId);
          break;

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
        await this.ensureBanker(table); // a banked table needs a house
        await this.pushLobby();
        break;
      case C2S.TABLE_STAND:
        await table.stand(conn);
        await this.processWaitlist(table); // a seat may have just opened
        await this.pushLobby();
        await this.maybeCloseTable(table);
        break;
      case C2S.WAITLIST_JOIN:
        await this.joinWaitlist(conn, table, msg.buyin);
        break;
      case C2S.WAITLIST_LEAVE:
        this.leaveWaitlist(conn.user.id, table.id);
        await this.pushLobby();
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
    // The inviter STAKES the bot: it plays with chips funded from — and returned
    // to — the inviter's wallet (the bot has no wallet of its own). attach()
    // resolves the tier per game and falls back to a sensible default.
    const bot = await this.botManager.attach(table, tierKey, { inviterId: conn.user.id, ...(seat != null ? { seat } : {}) });
    if (!bot) {
      return this._err(conn, "Couldn't seat a bot — the table's full, or you don't have enough chips to stake one.");
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
    await this.processWaitlist(table); // freed a seat
    await this.pushLobby();
    await this.maybeCloseTable(table);
  }

  // ------------------------------------------------------- waitlist (full tables)

  waitlistFor(tableId) { return this.waitlists.get(tableId) || []; }

  // Queue `conn`'s user for a seat at a full table. No-op (with a toast) if they're
  // already seated, already queued, or the table has room (they should just sit).
  async joinWaitlist(conn, table, buyin) {
    const uid = conn.user.id;
    if (table.seatForUser(uid)) return this._err(conn, "You're already seated here.");
    if (table.seats.size < table.config.maxSeats) return this._err(conn, "There's an open seat — just sit down.");
    const list = this.waitlists.get(table.id) || [];
    if (list.some((e) => e.userId === uid)) return; // already waiting
    const bb = table.config.bigBlind;
    let amt = buyin != null ? Number(buyin) : bb * 100;
    amt = Math.max(table.config.minBuyin, Math.min(table.config.maxBuyin, amt));
    list.push({ userId: uid, name: conn.user.displayName || conn.user.email, buyin: amt });
    this.waitlists.set(table.id, list);
    conn.send(encode(S2C.TOAST, { level: "info", text: `You're #${list.length} on the waitlist.` }));
    await this.pushLobby();
  }

  leaveWaitlist(userId, tableId) {
    const list = this.waitlists.get(tableId);
    if (!list) return;
    const next = list.filter((e) => e.userId !== userId);
    if (next.length) this.waitlists.set(tableId, next); else this.waitlists.delete(tableId);
  }

  // Drop a user from EVERY waitlist (on disconnect).
  _forgetWaitlists(userId) {
    for (const [tid, list] of this.waitlists) {
      const next = list.filter((e) => e.userId !== userId);
      if (next.length !== list.length) { if (next.length) this.waitlists.set(tid, next); else this.waitlists.delete(tid); }
    }
  }

  // Seat waitlisted players into open seats, head-first, until the table is full or
  // the queue empties. A candidate with no live connection, or whose buy-in fails
  // (e.g. insufficient chips), is dropped and we move on. Safe to call any time a
  // seat may have opened.
  async processWaitlist(table) {
    if (table._closed) return;
    const list = this.waitlists.get(table.id);
    if (!list || list.length === 0) return;
    while (list.length > 0 && table.seats.size < table.config.maxSeats) {
      const head = list[0];
      const targetConn = this.connsForUser(head.userId)[0];
      if (!targetConn || table.seatForUser(head.userId)) { list.shift(); continue; }
      const seat = this._firstOpenSeat(table);
      if (seat < 0) break;
      table.addWatcher(targetConn);
      await table.sit(targetConn, seat, head.buyin, { silent: true });
      list.shift(); // seated (or the buy-in failed — either way they leave the queue)
      if (table.seatForUser(head.userId)) {
        targetConn.send(encode(S2C.TOAST, { level: "success", text: `A seat opened at ${table.config.name} — you're in!` }));
        targetConn.send(encode(S2C.TABLE_CREATED, { tableId: table.id })); // pull them to the table
      }
    }
    if (list.length) this.waitlists.set(table.id, list); else this.waitlists.delete(table.id);
  }

  _firstOpenSeat(table) {
    for (let i = 0; i < table.config.maxSeats; i += 1) if (!table.seats.has(i)) return i;
    return -1;
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

  // A private message to a friend: gated on friendship, persisted, then echoed to
  // BOTH parties' online connections (so every open tab of either user updates).
  async routeDM(conn, msg) {
    if (!conn.user) return this._err(conn, "Sign in to message.", "AUTH");
    const toUserId = String(msg.toUserId || "");
    if (!toUserId || toUserId === conn.user.id) return;
    if (!(await areFriends(conn.user.id, toUserId))) {
      return this._err(conn, "You can only message friends.");
    }
    let row;
    try { row = await sendMessage(conn.user.id, toUserId, msg.text); }
    catch { return this._err(conn, "Message failed to send."); }
    if (!row) return; // empty after trim
    const out = encode(S2C.DM, {
      id: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId,
      fromName: conn.user.displayName || conn.user.email,
      text: row.body, ts: row.createdAt
    });
    for (const c of this.connsForUser(conn.user.id)) c.send(out);
    for (const c of this.connsForUser(toUserId)) c.send(out);
  }

  // ------------------------------------------- unified conversations (DM+group)

  // Resolve id -> { id, name } for a set of users (senders, members).
  async _usersInfo(ids) {
    const uniq = [...new Set((ids || []).filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = await dbQuery(
      `SELECT id, display_name, email, avatar_media_id FROM user WHERE id IN (${uniq.map(() => "?").join(",")})`,
      uniq
    );
    return new Map(rows.map((r) => [r.id, { id: r.id, name: r.display_name || r.email, avatarMediaId: r.avatar_media_id || null }]));
  }

  // Client-facing summary of one conversation, from `forUserId`'s view. For a DM
  // the title + `other` come from the other member; groups use their own fields.
  _convSummary(c, forUserId, info) {
    const memberInfos = c.members.map((id) => info.get(id) || { id, name: "Player" });
    let title = c.title;
    let other = null;
    if (c.kind === "dm") {
      const otherId = c.members.find((id) => id !== forUserId) || c.members[0];
      other = info.get(otherId) || { id: otherId, name: "Player" };
      title = other.name;
    }
    let last = c.last;
    if (last && last.senderId) last = { ...last, senderName: (info.get(last.senderId)?.name) || "Player" };
    return { id: c.id, kind: c.kind, title, other, members: memberInfos, last, unread: c.unread, lastMsgAt: c.lastMsgAt };
  }

  async sendConvList(conn) {
    if (!conn.user) return;
    const list = await convo.listConversations(conn.user.id);
    const allIds = new Set();
    for (const c of list) { for (const m of c.members) allIds.add(m); if (c.last?.senderId) allIds.add(c.last.senderId); }
    const info = await this._usersInfo([...allIds]);
    const conversations = list.map((c) => this._convSummary(c, conn.user.id, info));
    conn.send(encode(S2C.CONV_LIST, { conversations }));
  }

  async pushConvList(userId) {
    for (const c of this.connsForUser(userId)) await this.sendConvList(c);
  }

  async convOpen(conn, msg) {
    if (!conn.user) return this._err(conn, "Sign in.", "AUTH");
    let convId = msg.convId;
    let createdWith = null;
    if (!convId && msg.withUserId) {
      if (msg.withUserId === conn.user.id) return;
      if (!(await areFriends(conn.user.id, msg.withUserId))) return this._err(conn, "You can only message friends.");
      convId = await convo.getOrCreateDm(conn.user.id, msg.withUserId);
      createdWith = msg.withUserId;
    }
    if (!convId || !(await convo.isMember(convId, conn.user.id))) return this._err(conn, "No such conversation.");
    const header = await convo.getConversation(convId);
    const messages = await convo.getMessages(convId, 100);
    const ids = new Set(header.members.map((m) => m.userId));
    for (const m of messages) if (m.senderId) ids.add(m.senderId);
    const info = await this._usersInfo([...ids]);
    const enriched = messages.map((m) => ({ ...m, senderName: m.senderId ? (info.get(m.senderId)?.name || "Player") : null }));
    const summary = this._convSummary(
      { id: header.id, kind: header.kind, title: header.title, members: header.members.map((m) => m.userId), last: null, unread: 0, lastMsgAt: header.lastMsgAt },
      conn.user.id, info
    );
    await convo.markRead(convId, conn.user.id);
    conn.send(encode(S2C.CONV_MESSAGES, { convId, header: summary, messages: enriched }));
    // Make sure both sides list a freshly-created DM.
    await this.sendConvList(conn);
    if (createdWith) await this.pushConvList(createdWith);
  }

  async msgSend(conn, msg) {
    if (!conn.user) return this._err(conn, "Sign in to message.", "AUTH");
    let convId = msg.convId;
    let createdWith = null;
    if (!convId && msg.toUserId) {
      if (msg.toUserId === conn.user.id) return;
      if (await isBlocked(conn.user.id, msg.toUserId)) return this._err(conn, "You can't message this player.");
      if (!(await areFriends(conn.user.id, msg.toUserId))) return this._err(conn, "You can only message friends.");
      convId = await convo.getOrCreateDm(conn.user.id, msg.toUserId);
      createdWith = msg.toUserId;
    }
    if (!convId || !(await convo.isMember(convId, conn.user.id))) return this._err(conn, "You're not in that conversation.");
    let row;
    try { row = await convo.postMessage(convId, conn.user.id, { body: msg.text, mediaId: msg.mediaId, replyTo: msg.replyTo, kind: msg.mediaId ? "image" : "text" }); }
    catch { return this._err(conn, "Message failed to send."); }
    if (!row) return;
    await this._broadcastMsg(convId, row);
    // A brand-new DM needs to appear in both users' chat lists.
    if (createdWith) { await this.sendConvList(conn); await this.pushConvList(createdWith); }
  }

  async _broadcastMsg(convId, row) {
    const memberList = await convo.memberIds(convId);
    const info = await this._usersInfo([row.senderId, ...memberList]);
    const senderName = row.senderId ? (info.get(row.senderId)?.name || "Player") : null;
    const message = { ...row, senderName };
    const frame = encode(S2C.MSG, { convId, message });
    for (const uid of memberList) for (const c of this.connsForUser(uid)) c.send(frame);
    // Notify AWAY recipients so missed chats wait in the bell (online users
    // already have the live message + nav badge). Skip system messages.
    if (row.senderId) {
      const snippet = row.kind === "image" ? "📷 Photo" : String(row.body || "").slice(0, 80);
      for (const uid of memberList) {
        if (uid === row.senderId) continue;
        if (this.connsForUser(uid).length > 0) continue; // online → skip
        this.notify(uid, "message", { actorId: row.senderId, ref: convId, body: `${senderName}: ${snippet}` }).catch(() => {});
      }
    }
  }

  async msgRead(conn, msg) {
    if (!conn.user || !msg.convId) return;
    try {
      // Always advance my own read pointer (this is what clears my unread badge).
      await convo.markRead(msg.convId, conn.user.id);
      // Read receipts are reciprocal: a receipt travels from A to B only when
      // BOTH have receipts enabled. If I've turned mine off, I neither broadcast
      // my read position nor (via the same gate on their side) see others'.
      const mine0 = await this._socialSettings(conn.user.id);
      if (!mine0.readReceipts) return;
      const rows = await convo.readState(msg.convId);
      const mine = rows.find((r) => r.userId === conn.user.id);
      const frame = encode(S2C.CONV_READ, { convId: msg.convId, userId: conn.user.id, seq: mine?.seq ?? 0 });
      for (const uid of await convo.memberIds(msg.convId)) {
        if (uid === conn.user.id) continue;
        const theirs = await this._socialSettings(uid);
        if (!theirs.readReceipts) continue; // they opted out of seeing receipts
        for (const c of this.connsForUser(uid)) c.send(frame);
      }
    } catch { /* best effort */ }
  }

  async msgDelete(conn, msg) {
    if (!conn.user || !msg.convId || !msg.messageId) return;
    const ok = await convo.deleteMessage(msg.convId, msg.messageId, conn.user.id);
    if (!ok) return;
    const frame = encode(S2C.MSG_DELETED, { convId: msg.convId, messageId: msg.messageId });
    for (const uid of await convo.memberIds(msg.convId)) for (const c of this.connsForUser(uid)) c.send(frame);
  }

  async typing(conn, msg) {
    if (!conn.user || !msg.convId) return;
    if (!(await convo.isMember(msg.convId, conn.user.id))) return;
    // Respect the sender's "show when I'm typing" preference.
    const prefs = await this._socialSettings(conn.user.id);
    if (!prefs.typing) return;
    const frame = encode(S2C.TYPING, { convId: msg.convId, userId: conn.user.id, name: conn.user.displayName || conn.user.email });
    for (const uid of await convo.memberIds(msg.convId)) if (uid !== conn.user.id) for (const c of this.connsForUser(uid)) c.send(frame);
  }

  async groupCreate(conn, msg) {
    if (!conn.user) return this._err(conn, "Sign in.", "AUTH");
    const title = String(msg.title || "").trim().slice(0, 128) || "New group";
    const wanted = Array.isArray(msg.memberIds) ? [...new Set(msg.memberIds.filter((x) => x && x !== conn.user.id))] : [];
    const allowed = [];
    for (const uid of wanted) if (await areFriends(conn.user.id, uid)) allowed.push(uid);
    const convId = await convo.createGroup(conn.user.id, title, allowed);
    const sys = await convo.postMessage(convId, null, { kind: "system", body: `${conn.user.displayName || conn.user.email} created the group` });
    if (sys) await this._broadcastMsg(convId, sys);
    for (const uid of [conn.user.id, ...allowed]) await this.pushConvList(uid);
    return convId;
  }

  async groupUpdate(conn, msg) {
    if (!conn.user || !msg.convId) return;
    const role = await convo.roleOf(msg.convId, conn.user.id);
    if (role !== "owner" && role !== "admin") return this._err(conn, "Only admins can edit the group.");
    if (typeof msg.title === "string" && msg.title.trim()) {
      const t = msg.title.trim().slice(0, 128);
      await convo.rename(msg.convId, t);
      const sys = await convo.postMessage(msg.convId, null, { kind: "system", body: `${conn.user.displayName || conn.user.email} renamed the group to "${t}"` });
      if (sys) await this._broadcastMsg(msg.convId, sys);
    }
    for (const uid of await convo.memberIds(msg.convId)) await this.pushConvList(uid);
  }

  async groupMembers(conn, msg) {
    if (!conn.user || !msg.convId) return;
    const conv = await convo.getConversation(msg.convId);
    if (!conv || conv.kind !== "group") return this._err(conn, "Not a group.");
    const role = await convo.roleOf(msg.convId, conn.user.id);
    const add = Array.isArray(msg.add) ? msg.add.filter(Boolean) : [];
    const remove = Array.isArray(msg.remove) ? msg.remove.filter(Boolean) : [];
    const affected = new Set(await convo.memberIds(msg.convId));

    if (add.length && role !== "owner" && role !== "admin") return this._err(conn, "Only admins can add members.");
    const allowedAdd = [];
    for (const uid of add) {
      if (!(await areFriends(conn.user.id, uid))) continue;
      if (await convo.isMember(msg.convId, uid)) continue;
      // Respect the target's "let friends add me to groups" preference.
      const prefs = await this._socialSettings(uid);
      if (!prefs.allowGroupAdd) continue;
      allowedAdd.push(uid);
    }
    if (allowedAdd.length) {
      await convo.addMembers(msg.convId, allowedAdd);
      const info = await this._usersInfo(allowedAdd);
      const names = allowedAdd.map((id) => info.get(id)?.name || "Player").join(", ");
      const sys = await convo.postMessage(msg.convId, null, { kind: "system", body: `${conn.user.displayName || conn.user.email} added ${names}` });
      if (sys) await this._broadcastMsg(msg.convId, sys);
      allowedAdd.forEach((id) => affected.add(id));
    }
    for (const uid of remove) {
      const isSelf = uid === conn.user.id;
      if (!isSelf && role !== "owner" && role !== "admin") continue;
      if (!(await convo.isMember(msg.convId, uid))) continue;
      const info = await this._usersInfo([uid]);
      const name = info.get(uid)?.name || "Player";
      await convo.removeMember(msg.convId, uid);
      const sys = await convo.postMessage(msg.convId, null, { kind: "system", body: isSelf ? `${name} left` : `${conn.user.displayName || conn.user.email} removed ${name}` });
      if (sys) await this._broadcastMsg(msg.convId, sys);
      affected.add(uid);
    }
    for (const uid of affected) await this.pushConvList(uid);
  }

  // Live notification of a friend chip transfer (called from the profile action):
  // push new balances to both parties and drop a note into their DM.
  async notifyTransfer(fromId, toId, amount, fromBalance, toBalance) {
    for (const c of this.connsForUser(fromId)) c.send(encode(S2C.CHIPS, { chips: fromBalance }));
    for (const c of this.connsForUser(toId)) c.send(encode(S2C.CHIPS, { chips: toBalance }));
    try {
      const convId = await convo.getOrCreateDm(fromId, toId);
      const info = await this._usersInfo([fromId]);
      const fromName = info.get(fromId)?.name || "A friend";
      const sys = await convo.postMessage(convId, null, { kind: "system", body: `💸 ${fromName} sent ${Number(amount).toLocaleString()} chips` });
      if (sys) await this._broadcastMsg(convId, sys);
      await this.pushConvList(fromId);
      await this.pushConvList(toId);
      await this.notify(toId, "transfer", { actorId: fromId, body: `${fromName} sent you ${Number(amount).toLocaleString()} chips` });
    } catch { /* best effort */ }
  }

  // ------------------------------------------------------- voice (WebRTC mesh)

  // Everyone currently in a table's voice mesh, as [{ userId, name }].
  voiceUsers(tableId) {
    return [...(this.voiceRooms.get(tableId) || new Map()).entries()].map(([userId, name]) => ({ userId, name }));
  }

  // Push the current roster to every member's connections.
  _broadcastVoiceRoster(tableId) {
    const users = this.voiceUsers(tableId);
    const frame = encode(S2C.VOICE_ROSTER, { tableId, users });
    for (const { userId } of users) for (const c of this.connsForUser(userId)) c.send(frame);
  }

  // Join a table's voice mesh. Must be watching the table. The joiner gets the ICE
  // config (fresh ephemeral TURN creds) + the current roster; everyone's roster
  // updates so the WebRTC mesh can wire up (the newcomer is the offerer, client-side).
  // roomId is either a table id (authorised by watching it) or a conversation id
  // (authorised by membership) — one voice mesh serves in-game and social calls.
  async voiceJoin(conn, roomId) {
    if (!conn.user) return this._err(conn, "Sign in to use voice.", "AUTH");
    const ok = conn.watching?.has(roomId) || (await convo.isMember(roomId, conn.user.id));
    if (!ok) return this._err(conn, "Join the table or conversation first.");
    let room = this.voiceRooms.get(roomId);
    if (!room) { room = new Map(); this.voiceRooms.set(roomId, room); }
    room.set(conn.user.id, conn.user.displayName || conn.user.email);
    conn.send(encode(S2C.ICE_CONFIG, iceConfig()));
    this._broadcastVoiceRoster(roomId);
  }

  voiceLeave(conn, tableId) {
    const room = this.voiceRooms.get(tableId);
    if (!room || !conn.user) return;
    if (room.delete(conn.user.id)) {
      if (room.size === 0) this.voiceRooms.delete(tableId);
      this._broadcastVoiceRoster(tableId);
    }
  }

  // Drop a user from EVERY voice room (on disconnect), updating rosters.
  _forgetVoice(userId) {
    for (const [tableId, room] of this.voiceRooms) {
      if (room.delete(userId)) {
        if (room.size === 0) this.voiceRooms.delete(tableId);
        this._broadcastVoiceRoster(tableId);
      }
    }
  }

  // Relay one WebRTC signal (offer/answer/ICE) to a specific peer — but ONLY
  // between two members of the same table's voice mesh (so signaling can't be used
  // to spam arbitrary users).
  relaySignal(conn, msg) {
    if (!conn.user) return;
    const room = this.voiceRooms.get(msg.tableId);
    if (!room || !room.has(conn.user.id) || !room.has(msg.toUserId)) return;
    const frame = encode(S2C.RTC_SIGNAL, { tableId: msg.tableId, fromUserId: conn.user.id, signal: msg.signal });
    for (const c of this.connsForUser(msg.toUserId)) c.send(frame);
  }

  // ------------------------------------------------------- notifications

  // Create a notification (gated by the recipient's notify* prefs) and push it
  // live to their online sockets. Returns the stored row, or null if suppressed.
  async notify(userId, kind, payload) {
    try {
      const row = await createNotification(userId, kind, payload);
      if (row) {
        const frame = encode(S2C.NOTIF, { notification: row });
        for (const c of this.connsForUser(userId)) c.send(frame);
      }
      return row;
    } catch { return null; } // notifications are best-effort, never block the action
  }

  notifyFriendRequest(fromId, fromName, toId) {
    return this.notify(toId, "friend_request", { actorId: fromId, body: `${fromName} sent you a friend request` });
  }

  notifyFriendAccept(accepterId, accepterName, requesterId) {
    return this.notify(requesterId, "friend_accept", { actorId: accepterId, body: `${accepterName} accepted your friend request` });
  }

  async sendNotifList(conn) {
    if (!conn.user) return;
    try {
      const [notifications, unread] = await Promise.all([
        listNotifications(conn.user.id, 30),
        unreadCount(conn.user.id),
      ]);
      conn.send(encode(S2C.NOTIF_LIST, { notifications, unread }));
    } catch { /* best effort */ }
  }

  async notifRead(conn, msg) {
    if (!conn.user) return;
    try {
      await markNotifRead(conn.user.id, { all: !!msg.all, ids: Array.isArray(msg.ids) ? msg.ids : null });
      await this.sendNotifList(conn);
    } catch { /* best effort */ }
  }

  // ------------------------------------------------------- out-of-game voice calls
  //
  // A thin call-coordination layer (ring / accept / decline / hang-up) on top of
  // the existing voice mesh. The actual audio reuses voiceJoin(convId) + the
  // RTC_SIGNAL relay: on 'active', both clients join the DM conversation's voice
  // room and the mesh connects them. The friendship gate is areFriends.

  _callFor(userId) {
    for (const call of this.calls.values()) if (call.from === userId || call.to === userId) return call;
    return null;
  }

  _sendCall(userId, state, call, extra = {}) {
    const peerId = userId === call.from ? call.to : call.from;
    const frame = encode(S2C.CALL_STATE, {
      callId: call.id,
      state,
      peer: { userId: peerId, name: call.names?.[peerId] || "Player" },
      ...extra,
    });
    for (const c of this.connsForUser(userId)) c.send(frame);
  }

  _endCall(callId, endedState = "ended", exceptUserId = null) {
    const call = this.calls.get(callId);
    if (!call) return;
    if (call.timer) { clearTimeout(call.timer); call.timer = null; }
    this.calls.delete(callId);
    for (const uid of [call.from, call.to]) {
      if (uid === exceptUserId) continue;
      this._sendCall(uid, endedState, call);
    }
  }

  async callInvite(conn, msg) {
    if (!conn.user) return this._err(conn, "Sign in to call.", "AUTH");
    const toId = msg.toUserId;
    if (!toId || toId === conn.user.id) return;
    if (!(await areFriends(conn.user.id, toId))) return this._err(conn, "You can only call friends.");
    // One call at a time per party.
    if (this._callFor(conn.user.id)) return this._err(conn, "You're already in a call.");
    const call = { id: "call-" + randomBytes(8).toString("hex"), from: conn.user.id, to: toId, state: "ringing", names: {} };
    const info = await this._usersInfo([conn.user.id, toId]);
    call.names[conn.user.id] = info.get(conn.user.id)?.name || "Player";
    call.names[toId] = info.get(toId)?.name || "Player";
    call.convId = await convo.getOrCreateDm(conn.user.id, toId);

    if (this.connsForUser(toId).length === 0) {
      // Offline — nothing to ring. Tell the caller and drop a missed-call note.
      this._sendCall(conn.user.id, "unavailable", call);
      await this.notify(toId, "friend_request", { actorId: conn.user.id, body: `${call.names[conn.user.id]} tried to call you` }).catch(() => {});
      return;
    }
    if (this._callFor(toId)) { this._sendCall(conn.user.id, "busy", call); return; }

    this.calls.set(call.id, call);
    this._sendCall(conn.user.id, "ringing", call);
    const ring = encode(S2C.CALL_RING, { callId: call.id, fromUserId: conn.user.id, fromName: call.names[conn.user.id] });
    for (const c of this.connsForUser(toId)) c.send(ring);
    // Auto-cancel an unanswered call after 30s.
    call.timer = setTimeout(() => {
      const live = this.calls.get(call.id);
      if (live && live.state === "ringing") this._endCall(call.id, "ended");
    }, 30000);
  }

  async callAccept(conn, msg) {
    const call = this.calls.get(msg.callId);
    if (!call || !conn.user || call.to !== conn.user.id || call.state !== "ringing") return;
    call.state = "active";
    if (call.timer) { clearTimeout(call.timer); call.timer = null; }
    const extra = { room: call.convId, iceServers: iceConfig().iceServers };
    this._sendCall(call.from, "active", call, extra);
    this._sendCall(call.to, "active", call, extra);
  }

  callDecline(conn, msg) {
    const call = this.calls.get(msg.callId);
    if (!call || !conn.user || call.to !== conn.user.id) return;
    this._endCall(call.id, "declined");
  }

  callEnd(conn, msg) {
    const call = this.calls.get(msg.callId);
    if (!call || !conn.user || (call.from !== conn.user.id && call.to !== conn.user.id)) return;
    // Tell the other party; the hanger-upper already knows.
    this._endCall(call.id, "ended", conn.user.id);
  }

  // Disconnect cleanup: if a user drops with no remaining sockets, end their call.
  _forgetCalls(userId) {
    const call = this._callFor(userId);
    if (call) this._endCall(call.id, "ended", userId);
  }

  // ------------------------------------------------------- tournaments (Sit-N-Go)

  tournamentRows() {
    return [...this.tournaments.values()].map((t) => t.view());
  }

  // Create a Sit-N-Go: a tournament-mode LiveTable (chips are T-chips, no escrow)
  // plus a Tournament controller. The creator is auto-registered.
  async createTournament(conn, cfg) {
    if (!conn.user) return this._err(conn, "Sign in first.", "AUTH");
    const name = (cfg.name && String(cfg.name).trim().slice(0, 40)) || `${conn.user.displayName || conn.user.email}'s SNG`;
    const variant = VARIANT_KEYS.includes(cfg.variant) ? cfg.variant : "holdem";
    const entry = Math.max(0, Math.floor(Number(cfg.entry) || 0));
    const startingStack = Math.max(100, Math.floor(Number(cfg.startingStack) || 1500));
    const maxSeats = Math.min(9, Math.max(2, Math.floor(Number(cfg.maxSeats) || 6)));
    if (entry > 500_000) return this._err(conn, "Entry fee is too high.");
    if (entry > 0 && (await getBalance(conn.user.id)) < entry) {
      return this._err(conn, "Not enough chips for the entry.", "INSUFFICIENT_CHIPS");
    }
    const tid = "tny-" + randomBytes(8).toString("hex");
    const table = new LiveTable(
      { id: tid, name, variant, max_seats: maxSeats, small_blind: 0, big_blind: 0, min_buyin: 1, max_buyin: startingStack, tournament: true },
      this
    );
    table.createdBy = conn.user.id;
    table.creatorName = conn.user.displayName || conn.user.email;
    this.tables.set(tid, table);
    const t = new Tournament({ id: tid, name, variant, entry, startingStack, maxSeats, table, createdBy: conn.user.id });
    this.tournaments.set(tid, t);
    const r = await t.register(conn); // auto-register the creator
    if (r.error) { this.tournaments.delete(tid); this.tables.delete(tid); return this._err(conn, r.error); }
    conn.send(encode(S2C.TOAST, { level: "success", text: `Tournament "${name}" created — waiting for players.` }));
    await this.pushLobby();
  }

  async registerTournament(conn, tid) {
    const t = this.tournaments.get(tid);
    if (!t) return this._err(conn, "That tournament is no longer open.");
    const r = await t.register(conn);
    if (r.error) return this._err(conn, r.error);
    await this.pushLobby();
  }

  async unregisterTournament(conn, tid) {
    const t = this.tournaments.get(tid);
    if (!t || !conn.user) return;
    await t.unregister(conn.user.id);
    // If the creator unregisters an empty tournament, tear it down.
    if (t.status === "registering" && t.entrants.size === 0) {
      this.tournaments.delete(tid);
      this.botManager.forgetTable(tid);
      this.tables.delete(tid);
    }
    await this.pushLobby();
  }

  async startTournament(conn, tid) {
    const t = this.tournaments.get(tid);
    if (!t) return this._err(conn, "That tournament is no longer open.");
    if (t.createdBy !== conn.user.id) return this._err(conn, "Only the creator can start it.");
    if (t.status !== "registering") return this._err(conn, "Already started.");
    if (t.entrants.size < 1) return this._err(conn, "No one is registered yet.");
    const fill = Math.max(0, t.maxSeats - t.entrants.size);
    const bots = fill > 0 ? await this.botManager.makeBots(t.table, fill, "reg") : [];
    const r = await t.start({ bots });
    if (r.error) return this._err(conn, r.error);
    // Pull every registrant to the table.
    for (const [uid] of t.entrants) for (const c of this.connsForUser(uid)) c.send(encode(S2C.TABLE_CREATED, { tableId: tid }));
    await this.pushLobby();
  }

  // Tournament finished (called from Tournament._finish): toast placements, then
  // schedule teardown of the (now empty) table so players see the final result.
  async onTournamentComplete(t) {
    for (const [uid] of t.entrants) {
      const place = t.places.get(uid);
      for (const c of this.connsForUser(uid)) {
        c.send(encode(S2C.TOAST, { level: place === 1 ? "success" : "info", text: `Tournament over — you finished #${place ?? "?"} of ${t.entrants.size}.` }));
      }
    }
    await this.pushLobby();
    const tid = t.id;
    const timer = setTimeout(() => {
      this.botManager.forgetTable(tid);
      const table = this.tables.get(tid);
      if (table) { try { table._closed = true; table.clearActionTimer?.(); } catch { /* noop */ } }
      this.tables.delete(tid);
      this.tournaments.delete(tid);
      this.pushLobby();
    }, 20_000);
    timer.unref?.();
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
