// BotManager — owns the bots' identities and seats them at tables.
//
// Bots are REAL users (their own `user` rows + wallets) so they buy in through
// the exact escrow path humans use; nothing downstream special-cases them. This
// manager (a) lazily provisions a small roster of funded bot users, keyed by a
// reserved `.invalid` email domain so the leaderboard can exclude them, and
// (b) attaches/detaches BotConns to a LiveTable, tracking which identities are
// in use so one bot user is never seated at two tables at once.
//
// All DB/wallet touchpoints are injected (default: the real modules), so the
// unit tests run without a database.

import { randomBytes } from "node:crypto";
import * as realAuth from "../../auth.js";
import * as realWallet from "../../wallet.js";
import { BotConn } from "./conn.js";
import { TIERS } from "./tiers.js";
import { blackjackStrategy, BJ_TIERS } from "./blackjack-strategy.js";
import { casinoHoldemStrategy, CH_TIERS } from "./casino-holdem-strategy.js";
import { threeCardStrategy, TC_TIERS } from "./three-card-strategy.js";
import {
  betGameStrategy, BACCARAT_TIERS, ROULETTE_TIERS, SIC_BO_TIERS,
  DRAGON_TIGER_TIERS, CASINO_WAR_TIERS, ANDAR_BAHAR_TIERS, MONEY_WHEEL_TIERS, SLOTS_TIERS, CRAPS_TIERS
} from "./bet-game-strategy.js";
import { caribbeanStudStrategy, CS_TIERS } from "./caribbean-stud-strategy.js";
import { redDogStrategy, RD_TIERS } from "./red-dog-strategy.js";
import { ultimateHoldemStrategy, UTH_TIERS } from "./ultimate-holdem-strategy.js";
import { letItRideStrategy, LR_TIERS } from "./let-it-ride-strategy.js";
import { videoPokerStrategy, VP_TIERS } from "./video-poker-strategy.js";
import { kenoStrategy, KENO_TIERS } from "./keno-strategy.js";
import { paiGowStrategy, PG_TIERS } from "./pai-gow-strategy.js";
import { crazyEightsStrategy, CE_TIERS } from "./crazy-eights-strategy.js";

// Which brain + tier set a bot uses at a banked game (poker uses the default).
const GAME_BRAINS = {
  blackjack: { strategy: blackjackStrategy, tiers: BJ_TIERS, def: "basic" },
  "casino-holdem": { strategy: casinoHoldemStrategy, tiers: CH_TIERS, def: "basic" },
  "three-card": { strategy: threeCardStrategy, tiers: TC_TIERS, def: "basic" },
  baccarat: { strategy: betGameStrategy, tiers: BACCARAT_TIERS, def: "banker" },
  roulette: { strategy: betGameStrategy, tiers: ROULETTE_TIERS, def: "red" },
  "sic-bo": { strategy: betGameStrategy, tiers: SIC_BO_TIERS, def: "small" },
  "dragon-tiger": { strategy: betGameStrategy, tiers: DRAGON_TIGER_TIERS, def: "dragon" },
  "casino-war": { strategy: betGameStrategy, tiers: CASINO_WAR_TIERS, def: "ante" },
  "andar-bahar": { strategy: betGameStrategy, tiers: ANDAR_BAHAR_TIERS, def: "bahar" },
  "money-wheel": { strategy: betGameStrategy, tiers: MONEY_WHEEL_TIERS, def: "one" },
  "caribbean-stud": { strategy: caribbeanStudStrategy, tiers: CS_TIERS, def: "basic" },
  "red-dog": { strategy: redDogStrategy, tiers: RD_TIERS, def: "basic" },
  "ultimate-holdem": { strategy: ultimateHoldemStrategy, tiers: UTH_TIERS, def: "basic" },
  "let-it-ride": { strategy: letItRideStrategy, tiers: LR_TIERS, def: "basic" },
  "video-poker": { strategy: videoPokerStrategy, tiers: VP_TIERS, def: "basic" },
  slots: { strategy: betGameStrategy, tiers: SLOTS_TIERS, def: "low" },
  keno: { strategy: kenoStrategy, tiers: KENO_TIERS, def: "casual" },
  craps: { strategy: betGameStrategy, tiers: CRAPS_TIERS, def: "pass" },
  "pai-gow": { strategy: paiGowStrategy, tiers: PG_TIERS, def: "house" },
  "crazy-eights": { strategy: crazyEightsStrategy, tiers: CE_TIERS, def: "basic" }
};

// Reserved, non-routable domain (RFC 6761 `.invalid`) — guarantees no bot email
// ever collides with a real signup, and gives the leaderboard a clean filter.
export const BOT_EMAIL_DOMAIN = "bot.riverside.invalid";

// A small roster of personas. Each maps to one persistent bot `user` row.
const ROSTER = [
  { slug: "ivy", name: "Ivy" },
  { slug: "milo", name: "Milo" },
  { slug: "nora", name: "Nora" },
  { slug: "rex", name: "Rex" },
  { slug: "zoe", name: "Zoe" },
  { slug: "kai", name: "Kai" },
  { slug: "luna", name: "Luna" },
  { slug: "ace", name: "Ace" },
  { slug: "pip", name: "Pip" },
  { slug: "sol", name: "Sol" }
];

export class BotManager {
  constructor(deps = {}) {
    this.auth = deps.auth || realAuth;
    this.wallet = deps.wallet || realWallet;
    this.rng = deps.rng || Math.random;
    // Bot decisions can use a jittered scheduler for think-time; injectable for tests.
    this.schedule = deps.schedule || undefined;

    // userId -> { botConn, table } for every currently-seated bot.
    this._busy = new Map();
    // tableId -> Set<BotConn>
    this._byTable = new Map();
    // slug -> resolved identity { id, displayName } (cache; survives re-seats)
    this._identityCache = new Map();
  }

  isBotUser(userId) {
    return this._busy.has(userId);
  }

  botsAtTable(tableId) {
    return [...(this._byTable.get(tableId) || [])];
  }

  // Free any identity whose seat has since disappeared (e.g. a mid-hand detach
  // that cashed out at hand end). Cheap, called before we pick a fresh persona.
  _sweep() {
    for (const [uid, rec] of this._busy) {
      if (!rec.table.seatForUser(uid)) {
        this._busy.delete(uid);
        const set = this._byTable.get(rec.table.id);
        if (set) { set.delete(rec.botConn); if (set.size === 0) this._byTable.delete(rec.table.id); }
      }
    }
  }

  // Ensure a bot `user` row exists (idempotent by email) and is funded. Returns
  // { id, displayName }.
  async _ensureIdentity(persona) {
    if (this._identityCache.has(persona.slug)) return this._identityCache.get(persona.slug);
    const email = `${persona.slug}@${BOT_EMAIL_DOMAIN}`;
    let row = await this.auth.findUserByEmail(email);
    if (!row) {
      // Unusable random password — bots never authenticate.
      const pw = randomBytes(24).toString("hex");
      const created = await this.auth.createUser(email, pw, persona.name);
      row = { id: created.id, display_name: persona.name };
      await this.wallet.ensureStartingGrant(created.id);
    }
    const identity = { id: row.id, displayName: row.display_name || persona.name };
    this._identityCache.set(persona.slug, identity);
    return identity;
  }

  // Top the bot's wallet up to `target` if it's short, so a buy-in never fails.
  async _ensureFunded(userId, target) {
    const bal = await this.wallet.getBalance(userId);
    if (bal >= target) return;
    await this.wallet.adminAdjust(userId, target - bal, null);
  }

  _pickPersona() {
    for (const p of ROSTER) {
      const id = this._identityCache.get(p.slug)?.id;
      if (id == null || !this._busy.has(id)) return p; // never provisioned, or free
    }
    return null; // roster exhausted
  }

  // Seat a bot at `table`. Returns the BotConn, or null if it couldn't seat
  // (no open seat, roster exhausted, or the buy-in failed).
  async attach(table, tierKey, opts = {}) {
    if (table._closed) return null;
    this._sweep();

    // A banked GameTable gets that game's brain + tier set; everything else is a
    // poker table (default LiveTable) with the poker brain.
    const brain = GAME_BRAINS[table.game?.key] || null;
    const tiers = brain ? brain.tiers : TIERS;
    const tier = tiers[tierKey] || tiers[brain ? brain.def : "reg"];
    const seat = opts.seat != null ? Number(opts.seat) : this._firstOpenSeat(table);
    if (seat < 0 || table.seats.has(seat)) return null;

    const persona = this._pickPersona();
    if (!persona) return null;
    const identity = await this._ensureIdentity(persona);

    const bb = table.config.bigBlind;
    let buyin = opts.buyin != null ? Number(opts.buyin) : bb * 100;
    buyin = Math.max(table.config.minBuyin, Math.min(table.config.maxBuyin, buyin));
    // Keep a couple of buy-ins in the wallet so a rebuy after a bust also works.
    await this._ensureFunded(identity.id, Math.max(buyin, table.config.maxBuyin) * 2);

    const botConn = new BotConn({
      user: { id: identity.id, displayName: identity.displayName },
      tier,
      table,
      rng: this.rng === Math.random ? Math.random : this.rng,
      ...(brain ? { strategy: brain.strategy } : {}),
      ...(this.schedule ? { schedule: this.schedule } : {})
    });

    table.addWatcher(botConn);
    await table.sit(botConn, seat, buyin, { silent: true });
    if (!table.seatForUser(identity.id)) {
      // Buy-in lost a race / failed — roll the watcher back.
      table.removeWatcher(botConn);
      botConn.detach();
      return null;
    }

    this._busy.set(identity.id, { botConn, table });
    let set = this._byTable.get(table.id);
    if (!set) { set = new Set(); this._byTable.set(table.id, set); }
    set.add(botConn);
    return botConn;
  }

  // Seat a wealthy bot as the BANKER (house) of a banked table — used when no
  // human is willing to host. It buys in with a deep bankroll (allowed to exceed
  // the table max) so it can always cover player wins, and never acts (the dealer
  // plays itself). Sets table.bankerSeat. Returns the BotConn, or null.
  async attachBanker(table, opts = {}) {
    if (table._closed) return null;
    this._sweep();
    const seat = opts.seat != null ? Number(opts.seat) : this._firstOpenSeat(table);
    if (seat < 0 || table.seats.has(seat)) return null;

    const persona = this._pickPersona();
    if (!persona) return null;
    const identity = await this._ensureIdentity(persona);

    // Deep enough to cover every seat betting the table max and winning the
    // game's BIGGEST payout — 3:2 blackjack, but 8:1 baccarat tie, 35:1 roulette
    // straight-up, 30:1 sic-bo triple. A module declares `maxPayoutMultiple`;
    // card-comparison games keep the ~3:1 default.
    const payoutMult = table.game?.maxPayoutMultiple ?? 3;
    const bankroll = Math.max(100000, (table.config.maxBuyin || 0) * (table.config.maxSeats || 6) * payoutMult);
    await this._ensureFunded(identity.id, bankroll + 1000);

    const botConn = new BotConn({
      user: { id: identity.id, displayName: `${identity.displayName} (House)` },
      tier: TIERS.reg, table, rng: Math.random,
      ...(this.schedule ? { schedule: this.schedule } : {})
    });
    table.addWatcher(botConn);
    await table.sit(botConn, seat, bankroll, { silent: true, asBanker: true });
    if (!table.seatForUser(identity.id)) {
      table.removeWatcher(botConn); botConn.detach(); return null;
    }
    table.bankerSeat = seat;
    this._busy.set(identity.id, { botConn, table });
    let set = this._byTable.get(table.id);
    if (!set) { set = new Set(); this._byTable.set(table.id, set); }
    set.add(botConn);
    return botConn;
  }

  // Remove one bot from its table. Idle → cashes out now; mid-hand → folds out
  // and cashes out at hand end (the identity frees on the next _sweep).
  async detach(table, botConn) {
    const uid = botConn.user.id;
    await table.stand(botConn);
    const stillSeated = !!table.seatForUser(uid);
    table.removeWatcher(botConn);
    if (stillSeated) table.onConnectionGone?.(botConn); // shortened clock + vacate, like a human drop
    botConn.detach();
    if (!stillSeated) {
      this._busy.delete(uid);
      const set = this._byTable.get(table.id);
      if (set) { set.delete(botConn); if (set.size === 0) this._byTable.delete(table.id); }
    }
  }

  // Drop the registry for a table that's already gone (reclaimed / shut down):
  // stop bot timers and free their identities. No chip moves — cash-out already
  // happened (reap) or is handled by the caller (shutdown cashOutAll).
  forgetTable(tableId) {
    const set = this._byTable.get(tableId);
    if (!set) return;
    for (const botConn of set) {
      botConn.detach();
      this._busy.delete(botConn.user.id);
    }
    this._byTable.delete(tableId);
  }

  // Remove every bot at a table (table closing / shutting down).
  async detachAll(table) {
    for (const botConn of this.botsAtTable(table.id)) {
      try { await this.detach(table, botConn); } catch { /* best effort */ }
    }
  }

  // A table should not be kept alive by bots alone. If no human is present
  // (no non-bot watcher and no non-bot seat), remove the bots. Returns true if
  // it removed any (caller should then try to close the table).
  async reapIfNoHumans(table) {
    const humanWatcher = [...table.watchers].some((c) => !c.isBot);
    const humanSeat = [...table.seats.values()].some((s) => !this._busy.has(s.userId));
    if (humanWatcher || humanSeat) return false;
    if (this.botsAtTable(table.id).length === 0) return false;
    await this.detachAll(table);
    return true;
  }

  _firstOpenSeat(table) {
    for (let i = 0; i < table.config.maxSeats; i += 1) if (!table.seats.has(i)) return i;
    return -1;
  }
}
