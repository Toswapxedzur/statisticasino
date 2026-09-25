// The table's dealer: turns table-state changes into card flights and tells the DOM cards when
// to stay hidden, show face-down, or flip. One per table page (poker, flop games only — see
// deal-anim.js). DeckLayer.svelte draws what it describes on a canvas over the table.
//
// Everything that moves is a "flight" between two places, resolved to screen positions every
// frame by the layer (so the arena's zoom and window resizes never misalign a card):
//   { kind: "deck" }                    the face-down deck, top-left
//   { kind: "used" }                    the face-up used pile, top-right
//   { kind: "seat", seat, slot }        a card slot in a seat's hand
//   { kind: "board", slot }             a board slot
// Cards keep a visual id (1..52, their own edge strip) and, when public, their face.

import { DEAL, HOLE_COUNT, collectEvery, dealOrder, planDeal } from "./deal-anim.js";
import { buildRoutine } from "./deck-routine.js";
import { COUNT, FULL_DECK } from "./deck3d.js";

const ALL_CARDS = [..."23456789TJQKA"].flatMap((r) => [..."shdc"].map((u) => r + u));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Dealer {
  // ---- read by the DOM cards (reactive) ----
  hiddenSeats = $state(new Set());   // seats whose hand is in the air / collected: DOM hidden
  ownRevealed = $state(true);        // my cards: false = show backs (just landed), true = flipped up
  boardShown = $state(0);            // board slots showing a card (face-down until boardFaceUp)
  boardFaceUp = $state(0);
  tableHidden = $state(false);       // collection + routine: every hand and the board are on the canvas

  // ---- drawn by the layer ----
  deck = FULL_DECK.slice();          // visual ids, top → bottom
  used = [];                         // visual ids in landing order (last = the pile's top)
  faces = new Map();                 // visual id → card string, when the card is public
  flights = [];                      // { id, from, to, t0, dur, faceUp, arc, onLand }
  held = [];                         // cards the canvas holds in place: { id, at, faceUp, until }
  routine = null;                    // { R, t0, faceId } while the shuffle routine plays
  // sound cues, announced as each motion starts: { t, name, at?, gain?, dur? } where t is the frame
  // it lands (performance.now() clock) — cardLand · flip · pileTap · riffle (see table-audio.js)
  cues = [];

  constructor({ variant, mySeat = null } = {}) {
    this.holeCount = HOLE_COUNT[variant] ?? 2;
    this.mySeat = mySeat;
    this._queue = [];                 // [{ t, fn }] timed actions
    this._seatIds = new Map();        // seat → its cards' visual ids (by slot) this hand
    this._boardIds = [];              // board slot → visual id
    this._landed = new Map();         // seat → cards landed so far
    this._pendingMuck = new Map();    // seat → known faces: folded while its cards were in the air
    this._mucked = new Set();         // seats whose cards already went to the used pile this hand
    this._seed = Math.floor(Math.random() * 1e9);
    this.geom = null;                 // set by the layer: { deckSpot, usedSpot, centre } in units
  }

  // ---------------------------------------------------------------- state from the server
  /** First view (joining a table): no animation — what's already out is simply there. */
  init(view) {
    this.deck = FULL_DECK.slice();
    for (const s of view.seats || []) {
      if (!s.inHand || !s.hasCards) continue;
      if (s.status === "folded") { this._mucked.add(s.seat); continue; }
      this._seatIds.set(s.seat, Array.from({ length: this.holeCount }, () => this.deck.pop()));
      this._landed.set(s.seat, this.holeCount);
    }
    (view.board || []).forEach((c, i) => { const id = this.deck.pop(); this.faces.set(id, c); this._boardIds[i] = id; });
    this.used = [];
    this.boardShown = this.boardFaceUp = (view.board || []).length;
  }

  /** Called for every new table view (same table). privates = my hole cards when seated. */
  onView(prev, next, privates) {
    const t = now();
    if (next.handNo != null && next.handNo !== prev.handNo && (next.seats || []).some((s) => s.hasCards)) {
      this._newHand(next, t);
      return;
    }
    // folds: their cards go to the used pile (face-up only if they were public: mine)
    const prevBy = new Map((prev.seats || []).map((s) => [s.seat, s]));
    let k = 0;
    for (const s of next.seats || []) {
      const p = prevBy.get(s.seat);
      if (s.status === "folded" && p && p.status !== "folded" && this._seatIds.has(s.seat) && !this._mucked.has(s.seat)) {
        this._muck(s.seat, s.seat === this.mySeat ? privates?.holeCards : null, t + k * DEAL.muckEvery);
        k++;
      }
    }
    // new board cards: from the deck, face-down; the flop flips together once all three land
    const pb = (prev.board || []).length, nb = (next.board || []).length;
    if (nb > pb && !next.result) this._dealBoard(next.board, pb, nb, t);
    else if (nb > pb) {   // an all-in run-out arrives with the result: the cards are simply there
      for (let i = pb; i < nb; i++) { const id = this._take(); this.faces.set(id, next.board[i]); this._boardIds[i] = id; }
      this.boardShown = this.boardFaceUp = nb;
    }
    // the hand is over: the canvas takes every card over where it lies (a hand won without a
    // showdown vanishes from the seats right now), holds the result, then collects
    if (!prev.result && next.result) {
      this._takeOver(next, privates);
      this._at(t + DEAL.showdownHold, () => this._collect());
    }
  }

  // ---------------------------------------------------------------- phases
  _newHand(view, t) {
    // a routine still playing (a slow network, a hidden tab): finish it now
    this._finishRoutine();
    this.flights = [];
    this.held = [];
    this._queue = [];
    this._seatIds = new Map();
    this._boardIds = [];
    this._landed = new Map();
    this._pendingMuck = new Map();
    this._mucked = new Set();
    this.tableHidden = false;
    this.boardShown = this.boardFaceUp = 0;
    if (this.deck.length < COUNT) { this.deck = FULL_DECK.slice(); this.used = []; }
    const order = dealOrder(view.seats || [], view.buttonSeat);
    const plan = planDeal(order, this.holeCount);
    for (const s of order) { this._seatIds.set(s, []); this._landed.set(s, 0); }
    this.hiddenSeats = new Set(order);
    // my cards fly face-down; the DOM hand flips them after landing (no canvas face needed)
    this.ownRevealed = !order.includes(this.mySeat);
    for (const p of plan) {
      this._at(t + p.t0, () => {
        const id = this._take();
        this._seatIds.get(p.seat)[p.slot] = id;
        const at = { kind: "seat", seat: p.seat, slot: p.slot };
        this._fly({ id, from: { kind: "deck" }, to: at, dur: DEAL.flight, faceUp: false, cue: { name: "cardLand" } }, () => {
          this.held.push({ id, at, faceUp: false, seat: p.seat });
          const n = this._landed.get(p.seat) + 1;
          this._landed.set(p.seat, n);
          if (n < this.holeCount) return;
          if (this._pendingMuck.has(p.seat)) this._muck(p.seat, this._pendingMuck.get(p.seat), now());
          else this._showSeat(p.seat);
        });
      });
    }
  }

  _showSeat(seat) {
    const s = new Set(this.hiddenSeats); s.delete(seat); this.hiddenSeats = s;
    // the DOM hand is now visible (face-down); drop the canvas copies a moment later
    this._at(now() + 60, () => { this.held = this.held.filter((h) => h.seat !== seat || this._mucked.has(seat)); });
    if (seat === this.mySeat) {
      this._at(now() + DEAL.flipAfterLand, () => { this.ownRevealed = true; });
      this.cues.push({ t: now() + DEAL.flipAfterLand, name: "flip", at: { kind: "seat", seat } });
    }
  }

  _dealBoard(board, from, to, t) {
    let landed = 0;
    for (let i = from; i < to; i++) {
      this._at(t + (i - from) * DEAL.boardEvery, () => {
        const id = this._take();
        this.faces.set(id, board[i]);
        this._boardIds[i] = id;
        this._fly({ id, from: { kind: "deck" }, to: { kind: "board", slot: i }, dur: DEAL.flight, faceUp: false, cue: { name: "cardLand" } }, () => {
          this.held.push({ id, at: { kind: "board", slot: i }, faceUp: false, board: true });
          if (++landed === to - from) {
            this.boardShown = to;                                  // DOM slots appear, face-down
            this._at(now() + 60, () => { this.held = this.held.filter((h) => !h.board); });
            this._at(now() + DEAL.flipAfterLand, () => { this.boardFaceUp = to; });   // flip together
            this.cues.push({ t: now() + DEAL.flipAfterLand, name: "flip", at: { kind: "board" } });
          }
        });
      });
    }
  }

  _muck(seat, known, t) {
    this.hiddenSeats = new Set([...this.hiddenSeats, seat]);
    // folded before its own cards finished landing: they go on to the pile once they arrive
    if ((this._landed.get(seat) ?? this.holeCount) < this.holeCount) { this._pendingMuck.set(seat, known); return; }
    this._pendingMuck.delete(seat);
    this._mucked.add(seat);
    const ids = this._seatIds.get(seat) || [];
    ids.forEach((id, i) => {
      this._at(t + i * 40, () => {
        this.held = this.held.filter((h) => h.id !== id);
        if (known?.[i]) this.faces.set(id, known[i]);
        this._fly({ id, from: { kind: "seat", seat, slot: i }, to: { kind: "used" }, dur: DEAL.muckFlight, faceUp: !!known?.[i], cue: { name: "pileTap" } }, () => this.used.push(id));
      });
    });
  }

  _takeOver(view, privates) {
    // every card still out — hands first, then the board, so the pile ends with a public card on top
    const revealed = new Map((view.result?.revealed || []).map((r) => [r.seat, r.holeCards]));
    this.tableHidden = true;
    this.hiddenSeats = new Set((view.seats || []).map((s) => s.seat));
    // deals still queued / in the air to a seat or the board end where they were heading
    this._queue = [];
    const inAir = this.flights.filter((f) => f.to.kind !== "used");
    this.flights = this.flights.filter((f) => f.to.kind === "used");
    for (const f of inAir) if (f.to.kind === "seat") this._landed.set(f.to.seat, this.holeCount);
    this.held = [];
    const out = [];
    for (const [seat, ids] of this._seatIds) {
      if (this._mucked.has(seat)) continue;
      const faces = revealed.get(seat) || (seat === this.mySeat ? privates?.holeCards : null);
      ids.forEach((id, i) => { if (id == null) return; if (faces?.[i]) this.faces.set(id, faces[i]); out.push({ id, at: { kind: "seat", seat, slot: i }, faceUp: !!faces?.[i] }); });
    }
    this._boardIds.forEach((id, i) => { if (id != null) out.push({ id, at: { kind: "board", slot: i }, faceUp: true }); });
    this.held = out;
  }

  _collect() {
    const cards = this.held.slice(), t = now(), gap = collectEvery(cards.length);
    // what's left of the deck goes too, turning over as one packet onto the bottom of the pile
    // (the shuffle starts from all 52); its bottom card shows as it lands — an unseen card
    const rest = this.deck.slice();
    this.deck = [];
    if (rest.length) {
      const seen = new Set([...this.faces.values()]);
      const bottom = rest[rest.length - 1];
      const unseen = ALL_CARDS.filter((c) => !seen.has(c));
      this.faces.set(bottom, unseen[Math.floor(Math.random() * unseen.length)]);
      this._fly({ id: bottom, ids: rest, from: { kind: "deck" }, to: { kind: "used" }, dur: DEAL.collectFlight + 180, flip: true, arc: 34, cue: { name: "pileTap" } }, () => this.used.unshift(...rest));
    }
    cards.forEach((c, i) => {
      this._at(t + DEAL.collectEvery + i * gap, () => {
        this.held = this.held.filter((h) => h !== c);
        // each tap a little quieter than the last, so the collection settles instead of rattling
        this._fly({ id: c.id, from: c.at, to: { kind: "used" }, dur: DEAL.collectFlight, faceUp: c.faceUp, cue: { name: "pileTap", gain: Math.max(0.35, 1 - i * 0.07) } }, () => this.used.push(c.id));
      });
    });
    this._at(t + DEAL.collectEvery + Math.max(0, cards.length - 1) * gap + DEAL.collectFlight + 30, () => this._startRoutine());
  }

  _startRoutine() {
    if (!this.geom) return;
    const { usedSpot, deckSpot, centre } = this.geom;
    const R = buildRoutine({ start: usedSpot, end: deckSpot, centre, seed: this._seed++ });
    // the face showing as the used pile leaves: the top of the pile, if it is public
    const topId = this.used[this.used.length - 1];
    this.routine = { R, t0: now(), face: this.faces.get(topId) ?? null };
    // one continuous riffle for the shuffle phase (the third pile building up)
    const shuffle = R.phases.find((p) => p.name === "shuffle");
    if (shuffle) this.cues.push({ t: this.routine.t0 + shuffle.t0, name: "riffle", dur: shuffle.t1 - shuffle.t0 });
    this.used = [];
    this.deck = [];
  }

  _finishRoutine() {
    if (this.routine) { this.deck = this.routine.R.finalOrder.slice(); this.routine = null; this.used = []; }
  }

  // ---------------------------------------------------------------- clock
  /** Advance to `t`: run due actions, land finished flights, end the routine. */
  tick(t = now()) {
    this._queue.sort((a, b) => a.t - b.t);
    while (this._queue.length && this._queue[0].t <= t) this._queue.shift().fn();
    for (const f of this.flights) if (!f.done && t >= f.t0 + f.dur) { f.done = true; f.onLand?.(); }
    this.flights = this.flights.filter((f) => !f.done);
    // the routine ends with the deck back in its corner; the collected cards stay hidden until
    // the next hand arrives (the table still holds the old result until then)
    if (this.routine && t - this.routine.t0 >= this.routine.R.duration) this._finishRoutine();
  }
  /** Is anything moving (the layer keeps animating while true)? */
  get busy() { return !!(this.flights.length || this._queue.length || this.routine || this.held.length); }

  _at(t, fn) { this._queue.push({ t, fn }); }
  _fly({ cue, ...f }, onLand) {   // arc: a turning packet needs half a card width of lift
    const t0 = now();
    this.flights.push({ arc: DEAL.arc, ...f, t0, onLand });
    if (cue) this.cues.push({ t: t0 + f.dur, at: f.to, ...cue });   // the sound lands with the card
  }
  // the top card of the deck (forgetting any face its id carried last hand)
  _take() { const id = this.deck.shift() ?? this._takeLooseId(); this.faces.delete(id); return id; }
  // a card that isn't in the deck (a folded / collected one): reuse any id not in the deck or pile
  _takeLooseId() {
    const inUse = new Set([...this.deck, ...this.used, ...this.flights.flatMap((f) => f.ids || [f.id]), ...this.held.map((h) => h.id)]);
    let pick = 1;
    for (let id = 1; id <= COUNT; id++) if (!inUse.has(id)) { pick = id; break; }
    this.faces.delete(pick);
    return pick;
  }
  seatHidden(seat) { return this.tableHidden || this.hiddenSeats.has(seat); }
}
