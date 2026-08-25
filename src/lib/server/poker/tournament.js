// Sit-N-Go tournament controller. Owns a tournament-mode LiveTable (chips are pure
// T-CHIP counters, no escrow — see table.js `isTournament`) and drives the event:
// registration (entry fee -> prize pool), start (seat everyone with an equal
// starting stack), escalating blinds (by hands), eliminations, and payouts.
//
// Money conservation: the prize pool is exactly the sum of the human entry fees,
// and payouts always sum back to the pool (see `prizeSplit`), so wallet chips are
// conserved. Bots may fill seats but never pay in or cash out — the pool is split
// among the HUMAN entrants by their finishing order.
//
// The wallet layer is injectable ({ debit, credit }) so the logic is unit-tested
// without MySQL; `store` (optional) persists final places for history.

import * as realWallet from "../wallet.js";
import { REASON } from "../wallet.js";

// Blind schedule — level N applies after N*HANDS_PER_LEVEL hands. Escalating by
// HANDS (not a wall clock) is deterministic and plays nicely with the bot cadence.
export const BLIND_LEVELS = [
  { sb: 10, bb: 20 }, { sb: 15, bb: 30 }, { sb: 25, bb: 50 }, { sb: 50, bb: 100 },
  { sb: 75, bb: 150 }, { sb: 100, bb: 200 }, { sb: 150, bb: 300 }, { sb: 200, bb: 400 },
  { sb: 300, bb: 600 }, { sb: 500, bb: 1000 }, { sb: 800, bb: 1600 }, { sb: 1200, bb: 2400 },
  { sb: 2000, bb: 4000 }, { sb: 3000, bb: 6000 }, { sb: 5000, bb: 10000 }
];
export const HANDS_PER_LEVEL = 8;
export const DEFAULT_STARTING_STACK = 1500;

// The blind level for a given number of completed hands (clamped to the schedule).
export function levelForHands(hands, perLevel = HANDS_PER_LEVEL, levels = BLIND_LEVELS) {
  return Math.min(levels.length - 1, Math.floor(hands / perLevel));
}

// Prize split for `n` paid finishers over `pool` chips. v1 = winner-take-all;
// "top3" pays 50/30/20 (remainder chips to the higher place). Always sums to pool.
export function prizeSplit(pool, n, structure = "winner") {
  if (pool <= 0 || n <= 0) return [];
  if (structure === "top3" && n >= 3) {
    const a = Math.round(pool * 0.5);
    const b = Math.round(pool * 0.3);
    const c = pool - a - b; // remainder to 3rd keeps the sum exact
    return [a, b, c];
  }
  return [pool]; // winner-take-all
}

export class Tournament {
  // { id, name, variant, entry, startingStack?, maxSeats, table, wallet?, store?,
  //   payoutStructure?, handsPerLevel?, levels? }
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.variant = opts.variant || "holdem";
    this.entry = Number(opts.entry) || 0;
    this.startingStack = Number(opts.startingStack) || DEFAULT_STARTING_STACK;
    this.maxSeats = Number(opts.maxSeats) || 6;
    this.createdBy = opts.createdBy || null;
    this.table = opts.table;               // a tournament-mode LiveTable
    this.wallet = opts.wallet || realWallet;
    this.store = opts.store || null;
    this.payoutStructure = opts.payoutStructure || "winner";
    this.handsPerLevel = opts.handsPerLevel || HANDS_PER_LEVEL;
    this.levels = opts.levels || BLIND_LEVELS;

    this.status = "registering";           // registering | running | complete
    this.prizePool = 0;
    this.entrants = new Map();              // userId -> { name, conn } (humans who paid)
    this.botIds = new Set();                // userIds that are bots (no pay in/out)
    this.finishOrder = [];                  // userIds, bust order (index 0 = first out; last = winner)
    this.places = new Map();               // userId -> finishing place (1 = winner)
    this.handsPlayed = 0;
    this.level = 0;

    if (this.table) this.table.tournament = this;
  }

  registered(userId) { return this.entrants.has(userId); }
  seatsTaken() { return this.entrants.size; }
  isFull() { return this.entrants.size >= this.maxSeats; }

  // Register a human: debit the entry fee into the pool. Returns { ok } or { error }.
  async register(conn) {
    if (this.status !== "registering") return { error: "Registration is closed." };
    const userId = conn.user?.id;
    if (!userId) return { error: "Sign in to register." };
    if (this.entrants.has(userId)) return { error: "You're already registered." };
    if (this.isFull()) return { error: "This tournament is full." };
    if (this.entry > 0) {
      try {
        await this.wallet.debit(userId, this.entry, REASON.TOURNEY_ENTRY, this.id);
      } catch (e) {
        if (e?.code === "INSUFFICIENT_CHIPS") return { error: "Not enough chips for the entry." };
        return { error: "Entry failed." };
      }
      this.prizePool += this.entry;
    }
    this.entrants.set(userId, { name: conn.user.displayName || conn.user.email || String(userId), conn });
    return { ok: true };
  }

  // Cancel a registration and refund the entry (only while still registering).
  async unregister(userId) {
    if (this.status !== "registering" || !this.entrants.has(userId)) return { ok: false };
    if (this.entry > 0) {
      await this.wallet.credit(userId, this.entry, REASON.TOURNEY_ENTRY, this.id);
      this.prizePool -= this.entry;
    }
    this.entrants.delete(userId);
    return { ok: true };
  }

  // Begin play: seat every registrant (+ any filler bots) with the starting stack,
  // set the opening blinds, and deal the first hand. `bots` are BotConn-like conns.
  async start({ bots = [] } = {}) {
    if (this.status !== "registering") return { error: "Already started." };
    if (this.entrants.size < 1) return { error: "Need at least one registered player." };
    if (this.entrants.size + bots.length < 2) return { error: "Need at least 2 players (register more or let bots fill)." };

    const table = this.table;
    const level = this.levels[0];
    table.config.smallBlind = level.sb;
    table.config.bigBlind = level.bb;

    let seat = 0;
    const seatOne = async (conn, isBot) => {
      if (seat >= this.maxSeats) return;
      table.addWatcher(conn);
      await table.sit(conn, seat, this.startingStack, { tournament: true, silent: true });
      if (isBot && conn.user?.id != null) this.botIds.add(conn.user.id);
      seat += 1;
    };
    for (const { conn } of this.entrants.values()) await seatOne(conn, false);
    for (const bot of bots) await seatOne(bot, true);

    this.status = "running";
    this.handsPlayed = 0;
    this.level = 0;
    await table.beginHand();
    return { ok: true };
  }

  // Called by the table at each hand's end (table.tournament.onHandEnd). Escalates
  // blinds, records eliminations, and ends the event when one player remains.
  async onHandEnd(table) {
    if (this.status !== "running") return;
    this.handsPlayed += 1;

    // Escalate blinds for the level the next hand falls into.
    const lvl = levelForHands(this.handsPlayed, this.handsPerLevel, this.levels);
    if (lvl !== this.level) {
      this.level = lvl;
      table.config.smallBlind = this.levels[lvl].sb;
      table.config.bigBlind = this.levels[lvl].bb;
    }

    // Eliminate everyone who busted this hand (stack 0). If several bust together,
    // order them by remaining chips is moot (all 0) — use seat order for stability.
    const busted = [...table.seats.values()].filter((s) => (s.stack || 0) <= 0).sort((a, b) => a.seat - b.seat);
    for (const s of busted) {
      // If this bust would empty the table, keep the last one as the winner.
      if (table.seats.size <= 1) break;
      this.finishOrder.push(s.userId);
      table.seats.delete(s.seat);
    }

    // One player left → they win; end + pay out.
    if (table.seats.size === 1) {
      const winner = [...table.seats.values()][0];
      this.finishOrder.push(winner.userId);
      table.seats.delete(winner.seat);
      await this._finish(table);
    }
  }

  async _finish(table) {
    this.status = "complete";
    // Overall places: winner = last in finishOrder = 1st. place = n - index.
    const n = this.finishOrder.length;
    this.finishOrder.forEach((uid, i) => this.places.set(uid, n - i));

    // Pay the HUMAN entrants by their finish (best human first). Bots don't cash.
    const humansByFinish = [...this.finishOrder].reverse().filter((uid) => this.entrants.has(uid));
    const amounts = prizeSplit(this.prizePool, humansByFinish.length, this.payoutStructure);
    for (let i = 0; i < amounts.length; i += 1) {
      if (amounts[i] > 0) await this.wallet.credit(humansByFinish[i], amounts[i], REASON.TOURNEY_PRIZE, this.id);
    }

    // Persist final places for history (best-effort).
    if (this.store?.recordTournamentResult) {
      try {
        await this.store.recordTournamentResult(this.id, [...this.places.entries()]
          .filter(([uid]) => this.entrants.has(uid))
          .map(([uid, place]) => ({ userId: uid, place })));
      } catch { /* history is best-effort */ }
    }

    // Tear the table down (no escrow to settle in tournament mode).
    try { table.clearActionTimer?.(); } catch { /* noop */ }
    // Let the hub broadcast the result + schedule cleanup.
    try { await table.hub?.onTournamentComplete?.(this); } catch { /* best effort */ }
  }

  // Standings snapshot for the client HUD.
  view() {
    const remaining = this.table ? [...this.table.seats.values()].map((s) => ({ seat: s.seat, name: s.name, stack: s.stack, userId: s.userId })) : [];
    return {
      id: this.id, name: this.name, variant: this.variant, status: this.status,
      entry: this.entry, prizePool: this.prizePool, maxSeats: this.maxSeats,
      startingStack: this.startingStack,
      registered: this.entrants.size, remaining: remaining.length,
      entrantIds: [...this.entrants.keys()],
      createdBy: this.createdBy,
      level: this.level + 1, blinds: this.levels[this.level],
      nextLevelInHands: this.handsPerLevel - (this.handsPlayed % this.handsPerLevel),
      players: remaining,
      places: [...this.places.entries()].map(([userId, place]) => ({ userId, place }))
    };
  }
}
