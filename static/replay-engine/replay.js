// Round replay engine.
//
// `buildSteps(session, handIndex)` slices a session's frames down to the
// authoritative `updates[]` entries that belong to a single hand and turns
// each one into a "step". A step is one entry in the timeline the user can
// scrub through. Per the spec:
//
//   - Step granularity = one *authoritative* update per step. Non-authoritative
//     chatter (`tick`, `extendedConnections`, `dealerMessage`, `intent`,
//     `routeToUser` seat echoes) is stripped out before stepping begins.
//   - Each step also has a `milestone` flag — true for street boundaries
//     (`startHand`, `dealHoleCards`, `dealCommunityCards`, `showdown`,
//     `awardPot`, `finishHand`). Players' actions are non-milestone steps.
//
// `Replay` is the live state machine. It's *incremental*: `next()` mutates
// the current snapshot in place, `goto(k)` rebuilds from step 0 if the
// target is behind the current cursor (rewind = full rebuild), or just
// advances forward otherwise. This matches the user's Q2(ii) preference.
//
// Pure module — no DOM access. Loaded as a classic script that hangs
// `window.CasinoReplay`.

(function (root) {
  // Source of truth for the set of authoritative gameplay actions. Lives
  // in `tableize.js` so all hand-detection consumers agree on the same
  // vocabulary.
  const Tableize = (root && root.CasinoTableize) || null;

  // Subset of `updates[].action` that constitute a "step" the user is meant
  // to see. Mirrors DATA_FORMAT.md §4.2 authoritative list.
  const STEP_ACTIONS = new Set([
    "startHand", "blinds", "dealHoleCards", "dealCommunityCards",
    "check", "call", "bet", "raise", "fold", "allIn",
    "updatePots", "betRefund", "showdown", "show", "muck",
    "awardPot", "finishHand"
  ]);

  // Larger snap targets in the scrubber.
  const MILESTONE_ACTIONS = new Set([
    "startHand", "dealHoleCards", "dealCommunityCards",
    "showdown", "awardPot", "finishHand"
  ]);

  // ----------------------------------------------------------- step extraction

  // Walk a frames container, slice the run that belongs to the Nth hand
  // (matching `Tableize.detectHands` ordering), and produce one step per
  // authoritative update — then run a packaging pass that merges adjacent
  // updates into a single visible step where the user shouldn't see the
  // seam.
  //
  // A "step" is a tick on the scrubber. Each step holds an array of
  // raw `updates` that are applied in order when the engine advances to
  // that step. For legacy callers we expose `step.update` as the last
  // (most representative) raw update, which is enough for the existing
  // step-label / acting-seat / chip-amount lookups.
  // `container` may be either:
  //   - a `table` (with `frames` covering many hands) plus a `handIndex`
  //     to pick which hand; we re-derive boundaries internally.
  //   - a `hand` (already a single-hand frame slice) — pass `handIndex=0`
  //     and we just walk it end-to-end.
  // Both paths produce the same shape of `round`.
  function buildSteps(container, handIndex) {
    if (!container || !Array.isArray(container.frames)) return null;

    let startFrame, endFrame, handId;
    if (typeof container.startFrameIdx === "number" &&
        typeof container.endFrameIdx === "number") {
      // Single-hand container (a `Hand` from tableize.js). Frame indices
      // on the hand are absolute (into the parent table.frames), but the
      // hand also carries its OWN `frames` slice — walk that slice
      // directly with relative bounds.
      startFrame = 0;
      endFrame = container.frames.length - 1;
      handId = container.handId || null;
    } else {
      const handsBoundaries = computeHandBoundaries(container);
      if (handIndex < 0 || handIndex >= handsBoundaries.length) return null;
      const b = handsBoundaries[handIndex];
      startFrame = b.startFrame;
      endFrame = b.endFrame;
      handId = b.handId;
    }

    const raw = [];
    for (let fi = startFrame; fi <= endFrame; fi++) {
      const f = container.frames[fi];
      if (!f || f.event !== "output") continue;
      const updates = f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
      if (!updates) continue;
      for (const u of updates) {
        if (!u || typeof u !== "object" || !u.action) continue;
        if (!STEP_ACTIONS.has(u.action)) continue;
        raw.push({
          ts: f.ts,
          action: u.action,
          update: u,
          frameHandId: f.payload && (f.payload.handId ?? f.payload.hand_id) || null
        });
      }
    }

    return {
      handId: handId ? String(handId) : null,
      handIndex: handIndex || 0,
      tableId: container.tableId,
      tableName: container.tableName || container.title || null,
      pageTitle: container.pageTitle || null,
      steps: packageSteps(raw)
    };
  }

  // Pre-deal actions (`startHand`, `blinds`) carry real state effects (set
  // dealer button, post blinds, fill seats), but the user wanted them
  // hidden behind the deal — the round visibly *starts* when the cards
  // hit the felt. End-of-hand actions (`betRefund` and onwards) similarly
  // collapse: the user said the reward should be the LAST frame, with
  // `betRefund` happening at the same step as `awardPot`.
  //
  // The packager wraps the raw timeline into a smaller list of "packets",
  // each of which is one scrubber tick. A packet has:
  //   - action     (the "primary" action label, drives the step-label UI)
  //   - milestone  (true if this is a street/structural beat)
  //   - updates[]  (every raw update applied when stepping into this tick)
  //   - update     (the last raw update — kept for legacy reads)
  //
  // Currently merged groups:
  //   1. PRE-DEAL : every leading update up to and including the first
  //                 `dealHoleCards` collapses into one `dealHoleCards`
  //                 packet. The user only sees "deal" once; blinds /
  //                 startHand state is silently applied with it.
  //   2. AWARD    : `betRefund`, `showdown`, `muck`, `show`, `awardPot`,
  //                 and any `finishHand` afterwards collapse into one
  //                 terminal `awardPot` packet. Everything after the last
  //                 `awardPot` is dropped.
  function packageSteps(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const TERMINAL_ACTIONS = new Set([
      "betRefund", "showdown", "muck", "show", "awardPot", "finishHand"
    ]);

    // 1. PRE-DEAL merge: pull everything up to and including the FIRST
    // dealHoleCards into one packet labelled "dealHoleCards".
    const dealIdx = raw.findIndex((s) => s.action === "dealHoleCards");
    let head = [];
    let body = [];
    if (dealIdx === -1) {
      // No deal happened (very short / aborted hand). Leave the timeline
      // alone — every raw entry becomes its own one-update packet.
      body = raw.slice();
    } else {
      const preDeal = raw.slice(0, dealIdx + 1);
      head.push({
        ts: preDeal[preDeal.length - 1].ts,
        action: "dealHoleCards",
        milestone: true,
        updates: preDeal.map((s) => s.update),
        update: preDeal[preDeal.length - 1].update,
        frameHandId: preDeal[preDeal.length - 1].frameHandId
      });
      body = raw.slice(dealIdx + 1);
    }

    // 2. AWARD merge: find the LAST `awardPot` (some hands have multiple
    // pots — main + side); fold every TERMINAL_ACTIONS update from the
    // first such terminal-action onward into one packet.
    let lastAwardIdx = -1;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].action === "awardPot") { lastAwardIdx = i; break; }
    }
    if (lastAwardIdx === -1) {
      // No award captured (in-progress hand). Leave body alone.
      return head.concat(body.map(toPacket));
    }

    // Walk backwards from lastAwardIdx to find the first contiguous
    // run of terminal actions — we want to start the merge at the
    // earliest qualifying step (typically `betRefund`).
    let mergeStart = lastAwardIdx;
    while (mergeStart > 0 && TERMINAL_ACTIONS.has(body[mergeStart - 1].action)) {
      mergeStart--;
    }

    const middle = body.slice(0, mergeStart).map(toPacket);
    const terminalRaws = body.slice(mergeStart); // includes everything after, even trailing finishHand
    const tail = {
      ts: terminalRaws[terminalRaws.length - 1].ts,
      action: "awardPot",
      milestone: true,
      updates: terminalRaws.map((s) => s.update),
      update: (() => {
        // Pick the awardPot update as the "primary" so step labels read
        // sensibly; fall back to the last update if no awardPot was found
        // (shouldn't happen given lastAwardIdx).
        for (let i = terminalRaws.length - 1; i >= 0; i--) {
          if (terminalRaws[i].action === "awardPot") return terminalRaws[i].update;
        }
        return terminalRaws[terminalRaws.length - 1].update;
      })(),
      frameHandId: terminalRaws[terminalRaws.length - 1].frameHandId
    };

    return head.concat(middle, [tail]);
  }

  // Wrap a raw {ts, action, update} into the packet shape with a
  // single-element `updates` array.
  function toPacket(raw) {
    return {
      ts: raw.ts,
      action: raw.action,
      milestone: MILESTONE_ACTIONS.has(raw.action),
      updates: [raw.update],
      update: raw.update,
      frameHandId: raw.frameHandId
    };
  }

  // Find each hand's frame range. Mirrors Tableize.detectHands' loop, but
  // tracks frame indices instead of action counts.
  function computeHandBoundaries(session) {
    const out = [];
    let cur = null;

    function close(endIdx) {
      if (!cur) return;
      cur.endFrame = endIdx;
      out.push(cur);
      cur = null;
    }

    for (let i = 0; i < session.frames.length; i++) {
      const f = session.frames[i];
      if (f.event !== "output") continue;
      const updates = f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
      if (!updates) continue;

      const frameHandId = f.payload && (f.payload.handId ?? f.payload.hand_id);

      for (const u of updates) {
        if (!u || typeof u !== "object" || !u.action) continue;
        const action = u.action;
        const updateHandId = u.handId ?? u.hand_id ?? frameHandId ?? null;

        if (action === "startHand") {
          if (cur) close(i);  // mid-hand reconnect / table reset
          cur = { handId: updateHandId, startFrame: i, endFrame: i };
          continue;
        }

        if (!Tableize || !Tableize.AUTHORITATIVE_ACTIONS) continue;
        if (!Tableize.AUTHORITATIVE_ACTIONS.has(action)) continue;

        if (!cur) {
          cur = { handId: updateHandId, startFrame: i, endFrame: i };
        } else {
          if (!cur.handId && updateHandId) cur.handId = updateHandId;
        }

        if (action === "finishHand") {
          close(i);
        }
      }
    }
    if (cur) close(session.frames.length - 1);
    return out;
  }

  // -------------------------------------------- post-process: card revelations
  //
  // The poker server only deals real opponent hole cards in `dealHoleCards`
  // for the local user. Every other seat is dealt as `["X","X"]`. Sometimes
  // showdown reveals the cards via a `show` update. We pre-scan the round
  // so the UI knows, for any masked card, whether it is *eventually* revealed
  // — that's what enables the "click to peek" feature.
  function indexRevelations(round) {
    const revealed = new Map();   // seatId -> [card1, card2]
    if (!round) return revealed;
    for (const step of round.steps) {
      const u = step.update;
      if (u.action === "show" && u.seatId != null) {
        const cards = Array.isArray(u.cards) ? u.cards.slice(0, 2) : null;
        if (cards && cards.length === 2 && cards.every((c) => c && c !== "X")) {
          revealed.set(Number(u.seatId), cards);
        }
      }
      // Some servers stuff a player array on `awardPot` / `show` style steps
      // with full `cards`. Pick those up too.
      if (Array.isArray(u.players)) {
        for (const p of u.players) {
          if (p && p.seatId != null && Array.isArray(p.cards) && p.cards.length === 2) {
            const cs = p.cards;
            if (cs.every((c) => c && c !== "X") && !revealed.has(Number(p.seatId))) {
              revealed.set(Number(p.seatId), cs.slice(0, 2));
            }
          }
        }
      }
    }
    return revealed;
  }

  // -------------------------------------------------- engine: snapshot machine

  // Snapshot shape — what the renderer reads at any cursor position.
  //   {
  //     tableId, handId, dealerSeat,
  //     street: "preFlop" | "flop" | "turn" | "river" | "showdown" | null,
  //     board: ["5d", "4s", "Tc", ...],            // 0-5 cards
  //     pot:   total chips currently in the pot (sum of pots[].chips),
  //     pots:  [{chips, seatIds}, ...] for sidepots,
  //     seats: { [seatId]: {
  //                seatId, userId, stack, state, bet, lastAction,
  //                cards: ["6s","6c"] | ["X","X"] | null,
  //                folded, allIn, winnings,
  //                isCurrent, isDealer
  //              } },
  //     currentSeatId, lastAction: { seatId, action, chips }, finished
  //   }
  function emptySnapshot(round) {
    return {
      tableId: round.tableId,
      handId: round.handId,
      dealerSeat: null,
      street: null,
      board: [],
      pot: 0,
      pots: [],
      seats: Object.create(null),
      currentSeatId: null,
      lastAction: null,
      finished: false
    };
  }

  function ensureSeat(snap, seatId, partial) {
    const id = Number(seatId);
    if (!snap.seats[id]) {
      snap.seats[id] = {
        seatId: id,
        userId: null,
        stack: null,
        state: null,
        bet: 0,
        lastAction: null,
        cards: null,
        folded: false,
        allIn: false,
        winnings: 0,
        refund: 0,        // chips returned via betRefund this hand
        isCurrent: false,
        isDealer: false
      };
    }
    if (partial) Object.assign(snap.seats[id], partial);
    return snap.seats[id];
  }

  // Apply a single step's queued updates to `snap` in place.
  //
  // A step now carries an array `step.updates` — every raw update that
  // should land on this scrubber tick. The packager merges adjacent
  // updates (pre-deal block, end-of-hand block) so the user sees them
  // as one beat. We iterate those in order and apply each one.
  //
  // `revealed` (Map<seatId, [card1, card2]>) is the round-level revelation
  // map produced by `indexRevelations`. It is consulted at showdown so we
  // can auto-flip every non-mucked seat face-up even when the in-stream
  // `show` event omits per-seat cards on the actor seat.
  function applyStep(snap, step, revealed) {
    const updates = Array.isArray(step.updates) && step.updates.length
      ? step.updates
      : [step.update];
    for (const u of updates) {
      if (u) applyUpdate(snap, u, revealed);
    }
  }

  // Apply ONE raw update (one element of `step.updates`) to `snap`.
  function applyUpdate(snap, u, revealed) {
    const action = u.action;

    // Helper — sync the per-seat snapshot from a typical `players` array on
    // an action update.
    function applyPlayerArray(arr) {
      if (!Array.isArray(arr)) return;
      for (const p of arr) {
        if (!p || p.seatId == null) continue;
        const patch = {};
        if (p.userId != null) patch.userId = p.userId;
        if (p.stack != null) patch.stack = p.stack;
        if (p.bet != null) patch.bet = p.bet;
        if (p.state != null) patch.state = p.state;
        if (p.allIn === true) patch.allIn = true;
        if (Array.isArray(p.cards) && p.cards.length === 2) {
          // Don't *overwrite* a real revealed card with a masked one later.
          const seat = ensureSeat(snap, p.seatId);
          const havePrivate = Array.isArray(seat.cards) && seat.cards.every((c) => c && c !== "X");
          const incomingPrivate = p.cards.every((c) => c && c !== "X");
          if (!havePrivate || incomingPrivate) patch.cards = p.cards.slice(0, 2);
        }
        ensureSeat(snap, p.seatId, patch);
      }
    }

    switch (action) {
      case "startHand": {
        snap.dealerSeat = u.dealerSeat ?? snap.dealerSeat;
        snap.street = "preFlop";
        snap.handId = u.id != null ? String(u.id) : (snap.handId || null);
        snap.finished = false;
        snap.board = [];
        snap.pot = 0;
        snap.pots = [];
        snap.currentSeatId = null;
        snap.lastAction = null;
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            ensureSeat(snap, s.id, {
              userId: s.userId ?? null,
              stack: s.stack ?? null,
              state: s.state ?? null,
              bet: 0,
              folded: false,
              allIn: false,
              winnings: 0,
              refund: 0,
              cards: null,
              lastAction: null
            });
            snap.seats[s.id].isDealer = (s.id === snap.dealerSeat);
          }
        }
        applyPlayerArray(u.players);
        break;
      }
      case "blinds": {
        applyPlayerArray(u.players);
        if (Array.isArray(u.pots)) {
          snap.pots = u.pots.map((p) => ({ chips: p.chips || 0, seatIds: p.seatIds || [] }));
          snap.pot = snap.pots.reduce((n, p) => n + p.chips, 0);
        }
        break;
      }
      case "dealHoleCards": {
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            if (p && p.seatId != null && Array.isArray(p.cards)) {
              ensureSeat(snap, p.seatId, { cards: p.cards.slice(0, 2) });
            }
          }
        }
        break;
      }
      case "dealCommunityCards": {
        if (Array.isArray(u.cards)) {
          for (const c of u.cards) snap.board.push(c);
        }
        if (snap.board.length === 3) snap.street = "flop";
        else if (snap.board.length === 4) snap.street = "turn";
        else if (snap.board.length === 5) snap.street = "river";
        // handStrength updates ride along on `players` here too.
        applyPlayerArray(u.players);
        break;
      }
      case "check":
      case "call":
      case "bet":
      case "raise":
      case "fold":
      case "allIn": {
        const seatId = u.seatId;
        applyPlayerArray(u.players);
        if (seatId != null) {
          const seat = ensureSeat(snap, seatId);
          seat.lastAction = action;
          if (action === "fold") seat.folded = true;
          if (action === "allIn") seat.allIn = true;
          snap.lastAction = { seatId, action, chips: u.chips ?? 0 };
        }
        break;
      }
      case "updatePots": {
        // After a betting round closes: per-seat bets reset to 0, the pot
        // structure consolidates.
        if (Array.isArray(u.pots)) {
          snap.pots = u.pots.map((p) => ({ chips: p.chips || 0, seatIds: p.seatIds || [] }));
          snap.pot = snap.pots.reduce((n, p) => n + p.chips, 0);
        }
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            ensureSeat(snap, s.id, {
              state: s.state ?? null,
              userId: s.userId ?? null,
              stack: s.stack ?? null
            });
          }
        }
        if (Array.isArray(u.players)) {
          // Reset per-seat bet to 0 and apply any state hints.
          for (const p of u.players) {
            if (p && p.seatId != null) {
              ensureSeat(snap, p.seatId, {
                bet: 0,
                state: p.state ?? null,
                allIn: p.allIn === true ? true : false
              });
            }
          }
        }
        break;
      }
      case "betRefund": {
        applyPlayerArray(u.players);
        // The seat that gets the refund (`u.seatId`) keeps a small
        // `refund` accumulator so the renderer can show a cyan chip
        // stack on that seat at the award step. Pot shrinks by the
        // refunded amount; the next `awardPot` carries the corrected
        // number, so we don't manually subtract here.
        if (u.seatId != null && Number.isFinite(u.chips)) {
          const seat = ensureSeat(snap, u.seatId);
          seat.refund = (seat.refund || 0) + u.chips;
        }
        break;
      }
      case "showdown": {
        snap.street = "showdown";
        // At showdown, every non-folded, non-mucked seat whose hole cards
        // are *eventually* revealed in this round should already be
        // displayed face-up — the player has chosen to reveal them. We
        // stamp those cards onto the seat snapshot now, using the
        // pre-scanned `revealed` map (populated from later `show` /
        // `awardPot` payloads). Seats that ultimately muck stay masked.
        if (revealed) {
          for (const [seatId, cards] of revealed) {
            const seat = snap.seats[seatId];
            if (!seat) continue;
            if (seat.lastAction === "muck") continue;
            if (seat.folded) continue;
            const havePrivate = Array.isArray(seat.cards)
              && seat.cards.every((c) => c && c !== "X");
            if (!havePrivate) seat.cards = cards.slice(0, 2);
          }
        }
        break;
      }
      case "show": {
        // The server uses two shapes interchangeably here:
        //   { action:"show", seatId, cards:[...] }
        //   { action:"show", players:[ { seatId, cards:[...], state:"show" } ] }
        // Normalise both to a face-up seat snapshot.
        if (u.seatId != null && Array.isArray(u.cards) && u.cards.length === 2) {
          ensureSeat(snap, u.seatId, { cards: u.cards.slice(0, 2) });
        }
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            if (!p || p.seatId == null) continue;
            if (Array.isArray(p.cards) && p.cards.length === 2
                && p.cards.every((c) => c && c !== "X")) {
              ensureSeat(snap, p.seatId, { cards: p.cards.slice(0, 2) });
            }
          }
        }
        break;
      }
      case "muck": {
        // Cards stay hidden; we just record the gesture.
        if (u.seatId != null) ensureSeat(snap, u.seatId, { lastAction: "muck" });
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            if (p && p.seatId != null) {
              ensureSeat(snap, p.seatId, { lastAction: "muck" });
            }
          }
        }
        break;
      }
      case "awardPot": {
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            if (p && p.seatId != null) {
              const seat = ensureSeat(snap, p.seatId);
              seat.winnings += p.winnings || 0;
              if (p.winnings) seat.stack = (seat.stack ?? 0) + p.winnings;
            }
          }
        }
        break;
      }
      case "finishHand": {
        snap.finished = true;
        snap.currentSeatId = null;
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            ensureSeat(snap, s.id, {
              state: s.state ?? null,
              stack: s.stack ?? null,
              userId: s.userId ?? null
            });
          }
        }
        break;
      }
    }

    // Reset isCurrent on all seats; the renderer does its own to-act
    // highlighting from `lastAction` rather than the timer-only `tick`.
    for (const id in snap.seats) snap.seats[id].isCurrent = false;
  }

  // ------------------------------------------------------- engine controller

  function Replay(round) {
    this.round = round;
    this.revealed = indexRevelations(round);
    this.cursor = -1;          // -1 means "before step 0"
    this.snap = emptySnapshot(round);
  }

  Replay.prototype.length = function () {
    return this.round ? this.round.steps.length : 0;
  };

  Replay.prototype.snapshot = function () { return this.snap; };

  Replay.prototype.currentStep = function () {
    if (this.cursor < 0) return null;
    return this.round.steps[this.cursor] || null;
  };

  Replay.prototype.next = function () {
    if (this.cursor + 1 >= this.length()) return false;
    this.cursor++;
    applyStep(this.snap, this.round.steps[this.cursor], this.revealed);
    return true;
  };

  // Rewind = full rebuild from step 0 up to (and including) `target`. Cheap
  // for poker hands (≤ ~50 authoritative steps).
  Replay.prototype.goto = function (target) {
    const len = this.length();
    if (target < -1) target = -1;
    if (target >= len) target = len - 1;
    if (target < this.cursor) {
      this.snap = emptySnapshot(this.round);
      this.cursor = -1;
    }
    while (this.cursor < target) {
      this.cursor++;
      applyStep(this.snap, this.round.steps[this.cursor], this.revealed);
    }
    return this.cursor;
  };

  Replay.prototype.prev = function () {
    return this.goto(this.cursor - 1);
  };

  // True if seatId's hidden cards are eventually revealed in this round.
  Replay.prototype.peekCards = function (seatId) {
    const id = Number(seatId);
    return this.revealed.get(id) || null;
  };

  // ----------------------------------------------------------- short labels

  // Human-readable label for each step, used in the scrubber tooltip / list.
  function stepLabel(step) {
    const u = step.update;
    switch (step.action) {
      case "startHand":            return "Hand starts";
      case "blinds":               return "Blinds posted";
      case "dealHoleCards":        return "Deal hole cards";
      case "dealCommunityCards": {
        const cards = Array.isArray(u.cards) ? u.cards : [];
        if (cards.length === 1) return "River";
        if (cards.length === 3) return "Flop";
        return "Turn";
      }
      case "check":                return `Seat ${u.seatId} checks`;
      case "call":                 return `Seat ${u.seatId} calls ${u.chips ?? ""}`.trim();
      case "bet":                  return `Seat ${u.seatId} bets ${u.chips ?? ""}`.trim();
      case "raise":                return `Seat ${u.seatId} raises ${u.chips ?? ""}`.trim();
      case "fold":                 return `Seat ${u.seatId} folds`;
      case "allIn":                return `Seat ${u.seatId} all-in`;
      case "updatePots":           return "Pot update";
      case "betRefund":            return `Refund seat ${u.seatId}`;
      case "showdown":             return "Showdown";
      case "show":                 return `Seat ${u.seatId} shows`;
      case "muck":                 return `Seat ${u.seatId} mucks`;
      case "awardPot":             return "Award pot";
      case "finishHand":           return "Hand ends";
      default:                     return step.action;
    }
  }

  // Append fresh steps to an existing round (mutates round.steps in place)
  // and update the engine's `revealed` map to include any newly-shown cards.
  // Returns the number of steps appended. Used by history.js to keep open
  // replay panels live without rebuilding the engine from scratch.
  Replay.prototype.appendSteps = function (newSteps) {
    if (!Array.isArray(newSteps) || newSteps.length === 0) return 0;
    for (const step of newSteps) {
      this.round.steps.push(step);
      const u = step.update;
      // Re-run the same logic as indexRevelations for just this step so
      // the peek cache stays in sync as the round progresses live.
      if (u.action === "show" && u.seatId != null) {
        const cards = Array.isArray(u.cards) ? u.cards.slice(0, 2) : null;
        if (cards && cards.length === 2 && cards.every((c) => c && c !== "X")) {
          this.revealed.set(Number(u.seatId), cards);
        }
      }
      if (Array.isArray(u.players)) {
        for (const p of u.players) {
          if (p && p.seatId != null && Array.isArray(p.cards) && p.cards.length === 2) {
            const cs = p.cards;
            if (cs.every((c) => c && c !== "X") && !this.revealed.has(Number(p.seatId))) {
              this.revealed.set(Number(p.seatId), cs.slice(0, 2));
            }
          }
        }
      }
    }
    return newSteps.length;
  };

  root.CasinoReplay = {
    buildSteps,
    Replay,
    stepLabel,
    STEP_ACTIONS,
    MILESTONE_ACTIONS
  };
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
