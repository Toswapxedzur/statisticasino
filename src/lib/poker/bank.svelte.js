// The table's bank: turns table-state changes into coin motion (coin-motion.js) for EVERY game
// mode, and publishes the numbers the badges and the pot show while the coins move. One per table
// page; MoneyLayer.svelte draws the coins.
//
// Three money shapes (owner's spec 2026-09-25: coins sit beside the badge, add like digits):
//   poker    a seat's stack drops as it bets → a bet onto its pile; the street ends → the piles
//            sweep into the pot; the result → uncalled bets go home, the pot goes to the winners.
//   banked   the round's wagers (blackjack bet, ante + call, bet-game spots, keno ticket…) → piles;
//            settlement → the House pays winners into their piles and takes losers' piles, then
//            every pile goes home. (The server only moves stacks at settlement.)
//   shed     each player's ante → the pot at the start; the winner takes the pot.
// Whenever nothing is moving, the engine is snapped to what the server says, so it can't drift.

import { Money } from "./coin-motion.js";
import { isBanked, isShedding } from "./games.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Which money shape a view has. */
export function moneyKind(view) {
  if (!view) return null;
  const game = view.game || view.config?.variant;
  if (view.round?.shedGame || isShedding(game)) return "shed";
  if (isBanked(game)) return "banked";
  return "poker";
}

/** A banked round's wager for a seat: every bet / ante / call / spot / ticket it has out. */
export function wagerOf(round, seat) {
  if (!round) return 0;
  let w = 0;
  for (const h of round.hands || []) if (h.seat === seat) w += (h.bet || 0) + (h.ante || 0) + (h.call || 0);
  for (const b of round.bets || []) if (b.seat === seat) for (const x of b.bets || []) w += x.amount || 0;
  for (const k of round.tickets || []) if (k.seat === seat) w += k.amount || 0;
  return w;
}

export class Bank {
  // ---- read by the badges / the pot (reactive) ----
  shown = $state({});       // seat (or "house") → the stack number to show
  pot = $state(null);       // the pot number (poker / shed), null = use the view's

  constructor(kind) {
    this.kind = kind;
    this.money = new Money();
    this.view = null;
    this._dirty = true;
  }

  // ------------------------------------------------------------------ server views
  init(view) { this.view = view; this._snapTo(view); }

  onView(prev, next) {
    this.view = next;
    this._dirty = true;
    const t = now();
    const newRound = next.handNo != null && next.handNo !== prev.handNo;
    if (this.kind === "poker") this._poker(prev, next, t, newRound);
    else if (this.kind === "banked") this._banked(prev, next, t, newRound);
    else this._shed(prev, next, t, newRound);
  }

  _fresh(view, t, stackOf) {
    // a new round: whatever the last one left moving lands now, then the table starts clean
    this.money.finish(t);
    const stacks = {};
    for (const s of view.seats || []) if (s.userId != null) stacks[s.seat] = stackOf(s);
    const banker = this._banker(view);
    if (banker) stacks.house = banker.stack;
    this.money.snap(stacks, {});
  }

  _poker(prev, next, t, newRound) {
    const m = this.money;
    if (newRound) {
      // blinds / antes / straddles already posted with the new hand: from the badge onto the pile
      this._fresh(next, t, (s) => s.stack + (s.committed || 0));
      const posted = (next.seats || []).reduce((a, s) => a + (s.committed || 0), 0);
      const dead = (next.potTotal || 0) - posted;         // antes that went straight in
      if (dead > 0) m.snap(Object.fromEntries(m.stack), { pot: dead });
      for (const s of next.seats || []) if (s.committed > 0) m.bet(s.seat, s.committed, t);
      return;
    }
    const prevBy = new Map((prev.seats || []).map((s) => [s.seat, s]));
    const result = next.result && !prev.result;
    const won = new Map();
    for (const w of next.result?.winners || []) won.set(w.seat, (won.get(w.seat) || 0) + (w.amount || 0));
    for (const s of next.seats || []) {
      const p = prevBy.get(s.seat);
      if (!p || s.userId == null || p.userId !== s.userId) { if (s.userId != null) m.stack.set(s.seat, s.stack); continue; }
      if (!result) {
        const spent = p.stack - s.stack;
        if (spent > 0) m.bet(s.seat, spent, t);
        else if (spent < 0) m.stack.set(s.seat, (m.stack.get(s.seat) ?? 0) - spent);   // a rebuy / top-up
      } else {
        // net = −called + returned + won: a negative rest was a last call, a positive one an uncalled bet
        const rest = s.stack - p.stack - (won.get(s.seat) || 0);
        if (rest < 0) m.bet(s.seat, -rest, t);
        else if (rest > 0) m.giveBack(s.seat, rest, t);
      }
    }
    if (result) {
      m.sweep(t);
      const shares = [...won].filter(([, a]) => a > 0).map(([seat, amount]) => ({ seat, amount }));
      if (shares.length) m.award(shares, t);
    } else if (next.street !== prev.street) m.sweep(t);
  }

  _banked(prev, next, t, newRound) {
    const m = this.money;
    const players = (next.seats || []).filter((s) => s.userId != null && !s.isBanker);
    if (newRound) {
      this._fresh(next, t, (s) => s.stack);
      for (const s of players) { const w = wagerOf(next.round, s.seat); if (w > 0) m.bet(s.seat, w, t); }
      return;
    }
    const settled = next.result && !prev.result;
    for (const s of players) {
      const dw = wagerOf(next.round, s.seat) - wagerOf(prev.round, s.seat);
      if (dw > 0) m.bet(s.seat, dw, t);
      else if (dw < 0 && !settled) m.giveBack(s.seat, -dw, t);          // let-it-ride: a unit pulled back
    }
    if (!settled) return;
    for (const r of next.round?.results || []) {
      if (r.outcome === "banker" || r.seat == null) continue;
      if (r.delta > 0) m.bet(r.seat, r.delta, t, "house");               // the House pays onto the pile
      else if (r.delta < 0) m.collect(r.seat, -r.delta, t, "house");     // the House takes the loss
    }
    for (const s of players) m.giveBack(s.seat, Infinity, t);           // and every pile goes home
  }

  _shed(prev, next, t, newRound) {
    const m = this.money;
    if (newRound) {
      this._fresh(next, t, (s) => s.stack);
      const ante = next.config?.minBet ?? next.config?.smallBlind ?? 1;
      for (const p of next.round?.players || []) m.bet(p.seat, ante, t);
      m.sweep(t);
      return;
    }
    if (next.result && !prev.result) {
      const winner = next.round?.winner;
      const r = (next.round?.results || []).find((x) => x.seat === winner);
      const ante = next.config?.minBet ?? next.config?.smallBlind ?? 1;
      if (r && winner != null) m.award([{ seat: winner, amount: r.delta + ante }], t);
    }
  }

  _banker(view) {
    return view.bankerSeat != null ? (view.seats || []).find((s) => s.seat === view.bankerSeat) : null;
  }

  // ------------------------------------------------------------------ what the server says
  /** Stacks and piles as the view has them right now (for snapping when nothing moves). */
  _expected(view) {
    const stacks = {}, piles = {};
    const banker = this._banker(view);
    if (banker) stacks.house = banker.stack;
    const done = !!view.result;
    for (const s of view.seats || []) {
      if (s.userId == null || s.isBanker) continue;
      if (this.kind === "poker") {
        stacks[s.seat] = s.stack;
        if (!done && s.committed > 0) piles[`bet:${s.seat}`] = s.committed;
      } else if (this.kind === "banked") {
        const w = done ? 0 : wagerOf(view.round, s.seat);
        stacks[s.seat] = s.stack - w;
        if (w > 0) piles[`bet:${s.seat}`] = w;
      } else {
        const inRound = !done && (view.round?.players || []).some((p) => p.seat === s.seat);
        const ante = view.config?.minBet ?? view.config?.smallBlind ?? 1;
        stacks[s.seat] = s.stack - (inRound ? ante : 0);
      }
    }
    if (!done && this.kind === "poker") {
      const bets = (view.seats || []).reduce((a, s) => a + (s.committed || 0), 0);
      piles.pot = Math.max(0, (view.potTotal || 0) - bets);
    }
    if (!done && this.kind === "shed") piles.pot = (view.round?.players || []).length * (view.config?.minBet ?? view.config?.smallBlind ?? 1);
    return { stacks, piles };
  }
  _snapTo(view) {
    const { stacks, piles } = this._expected(view);
    this.money.snap(stacks, piles);
  }

  // ------------------------------------------------------------------ clock
  /** Advance the coins; publish the numbers; when all is still, agree with the server. */
  tick(t = now()) {
    const m = this.money;
    m.tick(t);
    if (this._dirty && this.view && !m.busy(t)) {
      this._dirty = false;
      const { stacks, piles } = this._expected(this.view);
      const same = Object.entries(stacks).every(([k, v]) => (m.stack.get(k === "house" ? "house" : +k) ?? 0) === v)
        && Object.entries(piles).every(([k, v]) => m.pileAt(k) === v)
        && [...m.piles.keys()].every((k) => (piles[k] || 0) === m.pileAt(k));
      if (!same) m.snap(stacks, piles);
    }
    const shown = {};
    for (const k of m.stack.keys()) shown[k] = m.stackAt(k, t);
    if (!this._banker(this.view || {})) delete shown.house;      // a House without a bankroll shows none
    let changed = false;
    for (const k of Object.keys(shown)) if (this.shown[k] !== shown[k]) { changed = true; break; }
    if (changed || Object.keys(this.shown).length !== Object.keys(shown).length) this.shown = shown;
    const pot = this.kind === "banked" ? null : m.potAt(t);
    if (pot !== this.pot) this.pot = pot;
  }

  /** The stack a badge shows for `seat` (a seat number, or "house"), or null for the view's own. */
  stackFor(seat) { const v = this.shown[seat]; return v == null ? null : v; }
}
