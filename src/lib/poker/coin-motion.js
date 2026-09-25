// Money on the table, in motion (owner's spec 2026-09-25). No DOM — the demo
// (design/coin-motion) and the table draw what this describes.
//
//   bet     coins leave the player's badge one denomination COLUMN at a time (highest first),
//           arc over and stack onto the player's pile in front of the seat; a raise adds to it.
//   check   no coins move — a knock.
//   sweep   when the street ends, every bet pile slides into the pot as one piece; all land
//           together, the pot re-groups by denomination and its number counts up.
//   return  an uncalled bet's excess slides back from the pile to the badge.
//   award   the pot flies to the winner (split / side pots: one share per winner), sinks into
//           the badge, and the stack counts up.
// Every move is minimum-jerk (speed and acceleration zero at both ends), with a small lift.
//
// Places, resolved to screen positions by the renderer every frame:
//   { kind: "stack", seat }   the seat's badge (its stack)
//   { kind: "bet", seat }     the seat's pile in front of it
//   { kind: "pot" }           the pot in the centre

/** Coin denominations: the metal ladder's tier minimums (chips.js), highest first. */
export const DENOMS = [5000000, 1000000, 250000, 50000, 10000, 2500, 500, 100, 25, 5, 1];

/** An amount as coin columns: [{ denom, count }], highest first (every coin counted). */
export function breakdown(amount) {
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  const out = [];
  for (const d of DENOMS) if (n >= d) { const count = Math.floor(n / d); n -= count * d; out.push({ denom: d, count }); }
  return out;
}

export const COIN = {
  every: 40,        // a bet's columns leave this far apart …
  flight: 380,      // … and land this long after leaving
  sweepAfter: 150,  // the sweep waits for the last bet to land, then this beat
  sweep: 520,
  back: 460,        // an uncalled bet sliding home
  awardAfter: 120,
  award: 600,
  awardEvery: 90,   // split pots: shares leave this far apart
  sink: 220,        // a landed win shrinks into the badge
  count: 520,       // the stack / pot number counting up
  arc: 0.16,        // lift at mid-flight, as a share of the distance (capped by the renderer)
};

export const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
export const bump = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; };

export class Money {
  /** stacks: { seat: amount } — each seat's chips behind the line at the start. */
  constructor(stacks = {}) {
    this.stack = new Map(Object.entries(stacks).map(([s, v]) => [+s, v]));  // settled values
    this.piles = new Map();        // "bet:<seat>" | "pot" → amount on the table (landed)
    this.flights = [];             // { id, kind: "column"|"pile", denom?, count?, amount, from, to, t0, dur, arc, sink }
    this.cues = [];                // { t, name } sound cues, at the moment coins land
    this._count = new Map();       // "stack:<seat>" | "pot" → { from, to, t0 } running count-ups
    this._queue = [];              // [{ t, fn, bet }] timed actions
    this._id = 0;
    this._seq = 0;
  }

  // ------------------------------------------------------------------ actions
  bet(seat, amount, t) {
    breakdown(amount).forEach((c, i) => {
      this._at(t + i * COIN.every, (now) => {
        const value = c.denom * c.count;
        this._setStack(seat, this.stack.get(seat) - value, null);   // leaves the badge at once
        this._fly({ kind: "column", denom: c.denom, count: c.count, amount: value, from: { kind: "stack", seat }, to: { kind: "bet", seat }, dur: COIN.flight }, now, (tl) => {
          this._pile(`bet:${seat}`, value);
          if (i === 0) this.cues.push({ t: tl, name: "bet" });
        });
      }, true);
    });
  }

  check(seat, t) { this._at(t, (now) => this.cues.push({ t: now, name: "check" })); }

  /** The street is over: every bet pile into the pot (after the last bet lands). */
  sweep(t) { this._whenSettled(t, COIN.sweepAfter, (now) => this._sweep(now)); }

  /** An uncalled bet: `amount` of the seat's pile goes back to its badge. */
  giveBack(seat, amount, t) {
    this._whenSettled(t, COIN.sweepAfter, (now) => {
      const key = `bet:${seat}`, have = this.piles.get(key) || 0, back = Math.min(have, amount);
      if (!back) return;
      this._pile(key, -back);
      this._fly({ kind: "pile", amount: back, from: { kind: "bet", seat }, to: { kind: "stack", seat }, dur: COIN.back, sink: COIN.sink }, now, (tl) => {
        this._setStack(seat, this.stack.get(seat) + back, tl);
      });
    });
  }

  /** The pot to the winners: shares [{ seat, amount }] (a split pot has several). */
  award(shares, t) {
    this._whenSettled(t, COIN.awardAfter, (now) => {
      // the pot's number finishes counting up before the pot leaves
      const c = this._count.get("pot");
      if (c && now < c.t0 + COIN.count) { this.award(shares, c.t0 + COIN.count + COIN.awardAfter); return; }
      let pot = this.piles.get("pot") || 0;
      shares.forEach((s, i) => {
        this._at(now + i * COIN.awardEvery, (t1) => {
          const amount = Math.min(s.amount, pot);
          pot -= amount;
          this._pile("pot", -amount);
          this._fly({ kind: "pile", amount, from: { kind: "pot" }, to: { kind: "stack", seat: s.seat }, dur: COIN.award, sink: COIN.sink }, t1, (tl) => {
            this._setStack(s.seat, this.stack.get(s.seat) + amount, tl);
            if (i === 0) this.cues.push({ t: tl, name: "winChips" });
          });
        });
      });
    });
  }

  // ------------------------------------------------------------------ clock
  /** Advance to `t`: run due actions (in time order), land flights, retire sunk ones. */
  tick(t) {
    for (;;) {
      this._queue.sort((a, b) => a.t - b.t);
      const flightDue = this.flights.filter((f) => !f.landed && f.t0 + f.dur <= t).sort((a, b) => a.t0 + a.dur - (b.t0 + b.dur))[0];
      const q = this._queue[0] && this._queue[0].t <= t ? this._queue[0] : null;
      if (!q && !flightDue) break;
      // whichever happened first (a sweep must see the bets that landed before it)
      if (flightDue && (!q || flightDue.t0 + flightDue.dur <= q.t)) {
        flightDue.landed = true;
        flightDue.onLand?.(flightDue.t0 + flightDue.dur);
      } else {
        this._queue.shift();
        q.fn(q.t);
      }
    }
    this.flights = this.flights.filter((f) => !f.landed || (f.sink && t < f.t0 + f.dur + f.sink));
  }

  /** Is anything still moving or counting at `t`? */
  busy(t) {
    return this._queue.length > 0 || this.flights.length > 0 || [...this._count.values()].some((c) => t < c.t0 + COIN.count);
  }

  // ------------------------------------------------------------------ what to draw
  /** The number a badge shows at `t` (counts up after a win lands). */
  stackAt(seat, t) { return this._shown(`stack:${seat}`, this.stack.get(seat) ?? 0, t); }
  /** The pot number at `t` (counts up as the sweep lands). */
  potAt(t) { return this._shown("pot", this.piles.get("pot") || 0, t); }
  /** A flight's state at `t`: progress u (0..1), eased s, lift (0..1 of the arc), sink (0..1). */
  flightAt(f, t) {
    const u = Math.min(1, Math.max(0, (t - f.t0) / f.dur));
    const sink = f.sink ? Math.min(1, Math.max(0, (t - f.t0 - f.dur) / f.sink)) : 0;
    return { u, s: mj(u), lift: bump(u) * (f.arc ?? 1), sink: mj(sink) };
  }

  // ------------------------------------------------------------------ internals
  _sweep(now) {
    let first = true;
    for (const [key, amount] of [...this.piles]) {
      if (!key.startsWith("bet:") || amount <= 0) continue;
      const seat = +key.slice(4);
      this.piles.delete(key);
      const isFirst = first;
      first = false;
      // all piles leave together and land together
      this._fly({ kind: "pile", amount, from: { kind: "bet", seat }, to: { kind: "pot" }, dur: COIN.sweep, arc: 0.35 }, now, (tl) => {
        const before = this.piles.get("pot") || 0;
        this._pile("pot", amount);
        this._countFrom("pot", this._shown("pot", before, tl), tl);
        if (isFirst) this.cues.push({ t: tl, name: "pot" });
      });
    }
  }
  _whenSettled(t, after, fn) {
    // wait for coins still travelling to the piles / pot, bets still queued, and any earlier
    // sweep / give-back / award still waiting its turn (they run in the order they were asked)
    const seq = ++this._seq;
    const run = (now) => {
      const moving = this.flights.filter((f) => !f.landed && f.to.kind !== "stack");
      const queued = this._queue.some((q) => q.t <= now && (q.bet || (q.seq && q.seq < seq)));
      if (queued || moving.length) {
        const next = moving.length ? Math.max(...moving.map((f) => f.t0 + f.dur)) + after : now + COIN.every;
        this._queue.push({ t: Math.max(next, now + 1), fn: run, seq });
        return;
      }
      fn(now);
    };
    this._queue.push({ t, fn: run, seq });
  }
  _at(t, fn, bet = false) { this._queue.push({ t, fn, bet }); }
  _fly(f, t0, onLand) { this.flights.push({ id: ++this._id, arc: 1, ...f, t0, onLand }); }
  _pile(key, delta) {
    const v = (this.piles.get(key) || 0) + delta;
    if (v > 0) this.piles.set(key, v); else this.piles.delete(key);
  }
  _setStack(seat, value, countFrom) {
    const key = `stack:${seat}`;
    if (countFrom != null) this._countFrom(key, this._shown(key, this.stack.get(seat) ?? 0, countFrom), countFrom);
    else this._count.delete(key);
    this.stack.set(seat, value);
  }
  _countFrom(key, from, t0) { this._count.set(key, { from, t0 }); }
  _shown(key, target, t) {
    const c = this._count.get(key);
    if (!c) return target;
    const u = (t - c.t0) / COIN.count;
    if (u >= 1) return target;
    if (u <= 0) return c.from;
    return Math.round(c.from + (target - c.from) * mj(u));
  }
}
