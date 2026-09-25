// Money on the table, in motion (owner's spec 2026-09-25). No DOM — the demo
// (design/coin-motion) and the table draw what this describes.
//
// Coins are an n-base number: 1, 5, 25, 100, 500, 2.5K, 10K, 50K, 250K, 1M, 5M (radix ×5 ×5 ×4,
// repeating). A pile is a set of COLUMNS, one per coin value — its digits — and every move is
// digit-wise:
//   bet     each column leaves the badge (highest value first) and lands on the SAME-VALUE column
//           of the player's pile beside the badge; a raise adds to it.
//   carry   when a column reaches its radix (5 coppers, 4 golds…), those coins MERGE into one coin
//           of the next value, which moves one step toward the badge; carries chain.
//   check   no coins move — a knock.
//   sweep   when the street ends, every pile's columns fly to the pot's same-value columns (all
//           land together), then the pot carries; its number counts up.
//   borrow  dividing a pile (a split pot, an uncalled bet's return) first BREAKS a bigger coin
//           into smaller ones where a digit is short, like subtraction.
//   return  the uncalled part of a bet flies back to the badge.
//   award   each winner's share flies from the pot to the badge, sinks into it; the stack counts up.
//   banked  the House pays a winner into the player's pile (a bet from the House badge), takes a
//           loser's pile (collect), and every pile then goes home (giveBack).
// Every move is minimum-jerk (speed and acceleration zero at both ends), with a small lift.
// A "seat" is a seat number, or "house" for the House badge.
//
// Places, resolved to screen positions by the renderer every frame:
//   { kind: "stack", seat }            the seat's badge (its stack)
//   { kind: "slot", pile, denom }      the column for `denom` in a pile ("bet:<seat>" | "pot")

/** Coin values, highest first (the metal ladder's tier minimums, chips.js). */
export const DENOMS = [5000000, 1000000, 250000, 50000, 10000, 2500, 500, 100, 25, 5, 1];
const UP = new Map(DENOMS.slice(1).map((d, i) => [d, DENOMS[i]]));     // d → the next coin up
const DOWN = new Map(DENOMS.slice(0, -1).map((d, i) => [d, DENOMS[i + 1]]));
/** How many of `d` make one of the next coin up (5, 5, 4, …); Infinity for the top coin. */
export const radix = (d) => (UP.has(d) ? UP.get(d) / d : Infinity);

/** An amount as coin columns: [{ denom, count }], highest first (every digit below its radix). */
export function breakdown(amount) {
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  const out = [];
  for (const d of DENOMS) if (n >= d) { const count = Math.floor(n / d); n -= count * d; out.push({ denom: d, count }); }
  return out;
}

export const COIN = {
  every: 40,        // a bet's columns leave this far apart …
  flight: 380,      // … and land this long after leaving
  settle: 60,       // coins land, then this beat before carries start
  merge: 260,       // a carry: radix coins merge into one and step toward the badge
  mergeEvery: 50,
  break: 260,       // a borrow: one coin breaks into smaller ones, stepping away from the badge
  sweepAfter: 150,  // the sweep waits for the last bet (and its carries), then this beat
  sweep: 520,
  back: 460,        // an uncalled bet flying home
  awardAfter: 120,
  award: 600,
  awardEvery: 90,   // split pots: shares leave this far apart
  sink: 220,        // a landed win shrinks into the badge
  count: 520,       // the stack / pot number counting up
  arc: 0.16,        // lift at mid-flight, as a share of the distance (capped by the renderer)
};

/** Sound cues, each at the exact moment of its motion: coins (a column lands on a pile, `count`
 *  coins), bet (a bet's first column lands), merge / break (a carry / borrow lands), sweep (the
 *  piles start for the pot), pot (they land), collect (winnings leave the pot), winChips (they
 *  land), sink (they're inside the badge), check (a knock — nothing moves). `at` = the place. */
export const CUES = ["coins", "bet", "merge", "break", "sweep", "pot", "collect", "winChips", "sink", "check"];

export const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
export const bump = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; };

export class Money {
  /** stacks: { seat: amount } — each seat's chips behind the line at the start. */
  constructor(stacks = {}) {
    this.stack = new Map(Object.entries(stacks).map(([s, v]) => [+s, v]));  // settled values
    this.piles = new Map();        // "bet:<seat>" | "pot" → Map(denom → count) of landed coins
    this.flights = [];             // { id, kind: "column"|"merge"|"break", denom, count, toDenom, toCount, amount, from, to, t0, dur, arc, sink }
    this.cues = [];                // { t, name, at?, count? } sound cues at the exact moment (see CUES)
    this.sweeps = [];              // { seat, amount, cols, t0, dur } — for the bet numbers riding into the pot
    this._count = new Map();       // "stack:<seat>" | "pot" → { from, t0 } running count-ups
    this._queue = [];              // [{ t, fn, bet?, seq?, norm? }] timed actions
    this._id = 0;
    this._seq = 0;
  }

  // ------------------------------------------------------------------ actions
  /** `amount` onto `seat`'s pile, paid from `payer`'s badge (the seat itself, or "house"). */
  bet(seat, amount, t, payer = seat) {
    const pile = `bet:${seat}`;
    breakdown(amount).forEach((c, i) => {
      this._at(t + i * COIN.every, (now) => {
        const value = c.denom * c.count;
        this._setStack(payer, (this.stack.get(payer) ?? 0) - value, null);   // leaves the badge at once
        this._fly({ kind: "column", denom: c.denom, count: c.count, amount: value, from: { kind: "stack", seat: payer }, to: { kind: "slot", pile, denom: c.denom }, dur: COIN.flight }, now, (tl) => {
          this._add(pile, c.denom, c.count, tl);
          this.cues.push({ t: tl, name: "coins", count: c.count, at: { kind: "slot", pile, denom: c.denom } });
          if (i === 0) this.cues.push({ t: tl, name: "bet" });
        });
      }, { bet: true });
    });
  }

  check(seat, t) { this._at(t, (now) => this.cues.push({ t: now, name: "check", at: { kind: "stack", seat } })); }

  /** The street is over: every pile's columns into the pot's same-value columns. */
  sweep(t) { this._whenSettled(t, COIN.sweepAfter, (now) => this._sweep(now)); }

  /** An uncalled bet: `amount` of the seat's pile goes back to its badge. */
  giveBack(seat, amount, t) {
    this._whenSettled(t, COIN.sweepAfter, (now) => {
      const pile = `bet:${seat}`, back = Math.min(this.amountOf(pile), amount);
      if (!back) return;
      this._take(pile, back, now, (t1, cols) => this._flyHome(pile, cols, seat, t1, COIN.back, null));
    });
  }

  /** `amount` of a seat's pile goes to another badge (a lost bet to the House); any part the
   *  pile doesn't hold comes straight from the seat's own badge. */
  collect(seat, amount, t, to = "house") {
    this._whenSettled(t, COIN.sweepAfter, (now) => {
      const pile = `bet:${seat}`, fromPile = Math.min(this.amountOf(pile), amount), rest = amount - fromPile;
      if (fromPile) this._take(pile, fromPile, now, (t1, cols) => this._flyHome(pile, cols, to, t1, COIN.back, null));
      if (rest > 0) this.transfer(seat, to, rest, now);
    });
  }

  /** Badge to badge (e.g. a hidden blind the House wins): columns leave one badge, sink into the other. */
  transfer(from, to, amount, t) {
    breakdown(amount).forEach((c, i) => {
      this._at(t + i * COIN.every, (now) => {
        const value = c.denom * c.count;
        this._setStack(from, (this.stack.get(from) ?? 0) - value, null);
        this._fly({ kind: "column", denom: c.denom, count: c.count, amount: value, from: { kind: "stack", seat: from }, to: { kind: "stack", seat: to }, dur: COIN.award, sink: COIN.sink }, now, (tl) => {
          this._setStack(to, (this.stack.get(to) ?? 0) + value, tl);
          if (i === 0) this.cues.push({ t: tl + COIN.sink, name: "sink", at: { kind: "stack", seat: to } });
        });
      });
    });
  }

  /** Everything still moving lands now (a new round arrived before the last one finished). */
  finish(t) { this.tick(t + 600000); this.flights = []; this._count.clear(); }

  /** Put the table in a known state at once, no motion: stacks { seat: n }, piles { key: amount }. */
  snap(stacks, piles) {
    this.stack = new Map(Object.entries(stacks).map(([k, v]) => [k === "house" ? "house" : +k, v]));
    this.piles = new Map();
    for (const [key, amount] of Object.entries(piles)) {
      if (!(amount > 0)) continue;
      this.piles.set(key, new Map(breakdown(amount).map((c) => [c.denom, c.count])));
    }
    this._count.clear();
  }

  /** The pot to the winners: shares [{ seat, amount }] (a split pot has several). */
  award(shares, t) {
    this._whenSettled(t, COIN.awardAfter, (now) => {
      // the pot's number finishes counting up before the pot leaves
      const c = this._count.get("pot");
      if (c && now < c.t0 + COIN.count) { this.award(shares, c.t0 + COIN.count + COIN.awardAfter); return; }
      const next = (i, t1) => {
        if (i >= shares.length) return;
        const s = shares[i], amount = Math.min(s.amount, this.amountOf("pot"));
        this._take("pot", amount, t1, (t2, cols) => {
          this._flyHome("pot", cols, s.seat, t2, COIN.award, i === 0 ? "winChips" : null);
          this._at(t2 + COIN.awardEvery, (t3) => next(i + 1, t3));
        });
      };
      next(0, now);
    });
  }

  // ------------------------------------------------------------------ clock
  /** Advance to `t`: run due actions and landings in time order, retire sunk flights. */
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
  /** A pile's landed columns, highest first: [[denom, count]]. */
  columnsOf(pile) { return [...(this.piles.get(pile) || [])].filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0]); }
  amountOf(pile) { let s = 0; for (const [d, n] of this.piles.get(pile) || []) s += d * n; return s; }
  /** Coin values a pile's layout must hold a place for: landed, arriving, or just leaving. */
  slotsOf(pile) {
    const ds = new Set(this.columnsOf(pile).map(([d]) => d));
    for (const f of this.flights) {
      if (f.landed) continue;
      if (f.to.kind === "slot" && f.to.pile === pile) ds.add(f.to.denom);
      if (f.from.kind === "slot" && f.from.pile === pile) ds.add(f.from.denom);
    }
    return [...ds].sort((a, b) => b - a);
  }
  /** The number a badge shows at `t` (counts up after a win lands). */
  stackAt(seat, t) { return this._shown(`stack:${seat}`, this.stack.get(seat) ?? 0, t); }
  /** Every pile's amount including its own merges / breaks in the air. */
  pileAt(pile) { return this.amountOf(pile) + this._inPile(pile); }
  /** The pot number at `t` (counts up as the sweep lands). */
  potAt(t) { return this._shown("pot", this.amountOf("pot") + this._inPile("pot"), t); }
  /** A flight's state at `t`: progress u (0..1), eased s, lift (0..1 of the arc), sink (0..1). */
  flightAt(f, t) {
    const u = Math.min(1, Math.max(0, (t - f.t0) / f.dur));
    const sink = f.sink ? Math.min(1, Math.max(0, (t - f.t0 - f.dur) / f.sink)) : 0;
    return { u, s: mj(u), lift: bump(u) * (f.arc ?? 1), sink: mj(sink) };
  }

  // ------------------------------------------------------------------ internals
  _sweep(now) {
    let first = true;
    for (const key of [...this.piles.keys()]) {
      if (!key.startsWith("bet:")) continue;
      const cols = this.columnsOf(key), amount = this.amountOf(key), seat = +key.slice(4);
      this.piles.delete(key);
      if (!amount) continue;
      this.sweeps.push({ seat, amount, cols, t0: now, dur: COIN.sweep });
      if (first) this.cues.push({ t: now, name: "sweep", at: { kind: "pot" } });
      const isFirst = first;
      first = false;
      // every column to the pot's same-value column; all piles leave together and land together
      cols.forEach(([d, n], i) => {
        this._fly({ kind: "column", denom: d, count: n, amount: d * n, from: { kind: "slot", pile: key, denom: d }, to: { kind: "slot", pile: "pot", denom: d }, dur: COIN.sweep, arc: 0.35 }, now, (tl) => {
          const before = this.potAt(tl);
          this._add("pot", d, n, tl);
          this._countFrom("pot", before, tl);
          if (isFirst && i === 0) this.cues.push({ t: tl, name: "pot" });
        });
      });
    }
  }

  /** Coins land on a pile's column; after a beat, carry. */
  _add(pile, d, n, t) {
    const p = this.piles.get(pile) || new Map();
    p.set(d, (p.get(d) || 0) + n);
    this.piles.set(pile, p);
    if (n > 0 && (p.get(d) || 0) >= radix(d)) this._at(t + COIN.settle, (now) => this._carry(pile, now), { norm: true });
  }
  /** Every column at or over its radix: radix coins merge into one coin of the next value. */
  _carry(pile, now) {
    const p = this.piles.get(pile);
    if (!p) return;
    let k = 0;
    for (const d of [...DENOMS].reverse()) {
      const r = radix(d), groups = Math.floor((p.get(d) || 0) / r);
      for (let g = 0; g < groups; g++) {
        this._at(now + (k++) * COIN.mergeEvery, (t1) => {
          const q = this.piles.get(pile);
          if (!q || (q.get(d) || 0) < r) return;           // the coins left meanwhile (a sweep)
          q.set(d, q.get(d) - r);                         // they leave the column as they merge
          this._fly({ kind: "merge", denom: d, count: r, toDenom: UP.get(d), toCount: 1, amount: d * r, from: { kind: "slot", pile, denom: d }, to: { kind: "slot", pile, denom: UP.get(d) }, dur: COIN.merge, arc: 0.5 }, t1, (tl) => {
            this._add(pile, UP.get(d), 1, tl);
            this.cues.push({ t: tl, name: "merge", at: { kind: "slot", pile, denom: UP.get(d) } });
          });
        }, { norm: true });
      }
    }
  }
  /**
   * Take `amount` off a pile digit by digit. Where a digit is short, break the nearest bigger coin
   * into smaller ones (one step at a time, animated) and look again; then hand the columns over.
   */
  _take(pile, amount, now, done) {
    const need = breakdown(amount);
    const step = (t) => {
      const p = this.piles.get(pile) || new Map();
      this.piles.set(pile, p);
      for (const { denom: d, count: n } of [...need].reverse()) {       // smallest digit first
        if ((p.get(d) || 0) >= n) continue;
        const e = [...DENOMS].reverse().find((x) => x > d && (p.get(x) || 0) > 0);
        if (e == null) break;                                           // can't happen for amount ≤ pile
        const below = DOWN.get(e), r = radix(below);
        p.set(e, p.get(e) - 1);
        this._fly({ kind: "break", denom: e, count: 1, toDenom: below, toCount: r, amount: e, from: { kind: "slot", pile, denom: e }, to: { kind: "slot", pile, denom: below }, dur: COIN.break, arc: 0.5 }, t, (tl) => {
          p.set(below, (p.get(below) || 0) + r);
          this.cues.push({ t: tl, name: "break", count: r, at: { kind: "slot", pile, denom: below } });
          this._at(tl + COIN.settle, step, { norm: true });
        });
        return;
      }
      for (const { denom: d, count: n } of need) p.set(d, Math.max(0, (p.get(d) || 0) - n));
      done(t, need.map((c) => [c.denom, c.count]));
    };
    step(now);
  }
  /** Columns leave a pile for a badge together; they sink into it and the stack counts up. */
  _flyHome(pile, cols, seat, t, dur, cue) {
    if (pile === "pot") this.cues.push({ t, name: "collect", at: { kind: "pot" } });
    if (cols.length) this.cues.push({ t: t + dur + COIN.sink, name: "sink", at: { kind: "stack", seat } });
    cols.forEach(([d, n], i) => {
      this._fly({ kind: "column", denom: d, count: n, amount: d * n, from: { kind: "slot", pile, denom: d }, to: { kind: "stack", seat }, dur, sink: COIN.sink }, t, (tl) => {
        this._setStack(seat, (this.stack.get(seat) ?? 0) + d * n, tl);
        if (cue && i === 0) this.cues.push({ t: tl, name: cue });
      });
    });
  }
  /** Value inside a pile's own merges / breaks (still the pile's money while it moves). */
  _inPile(pile) {
    let s = 0;
    for (const f of this.flights) if (!f.landed && f.kind !== "column" && f.from.pile === pile) s += f.amount;
    return s;
  }
  _whenSettled(t, after, fn) {
    // wait for coins travelling to piles, bets still queued, carries / breaks pending, and any
    // earlier sweep / give-back / award still waiting its turn (they run in the order asked)
    const seq = ++this._seq;
    const run = (now) => {
      const moving = this.flights.filter((f) => !f.landed && f.to.kind !== "stack");
      const queued = this._queue.some((q) => q.norm || (q.seq && q.seq < seq) || (q.bet && q.t <= now));
      if (queued || moving.length) {
        const next = moving.length ? Math.max(...moving.map((f) => f.t0 + f.dur)) + after : now + COIN.every;
        this._queue.push({ t: Math.max(next, now + 1), fn: run, seq });
        return;
      }
      fn(now);
    };
    this._queue.push({ t, fn: run, seq });
  }
  _at(t, fn, flags = {}) { this._queue.push({ t, fn, ...flags }); }
  _fly(f, t0, onLand) { this.flights.push({ id: ++this._id, arc: 1, ...f, t0, onLand }); }
  _setStack(seat, value, countFrom) {
    const key = `stack:${seat}`;
    if (countFrom != null) this._countFrom(key, this._shown(key, this.stack.get(seat) ?? 0, countFrom), countFrom);
    else this._count.delete(key);
    this.stack.set(seat, value);
  }
  _countFrom(key, from, t0) {
    // a count already starting at this instant keeps its starting number (several columns land at once)
    const c = this._count.get(key);
    if (c && c.t0 === t0) return;
    this._count.set(key, { from, t0 });
  }
  _shown(key, target, t) {
    const c = this._count.get(key);
    if (!c) return target;
    const u = (t - c.t0) / COIN.count;
    if (u >= 1) return target;
    if (u <= 0) return c.from;
    return Math.round(c.from + (target - c.from) * mj(u));
  }
}
