<script>
  import { onMount, tick } from "svelte";

  let { handKey } = $props();

  let loading = $state(true);
  let error = $state(null);
  let payload = $state(null);

  // The local "slot" object is shaped exactly like the one the extension's
  // history.js keeps in `state.replays`. The renderer functions copied
  // below read from it directly. We do NOT mirror it into Svelte $state;
  // it's mutated imperatively by the renderer and Svelte never needs to
  // re-render around it.
  let slot = null;
  // The DOM element where the cloned extension panel template lives.
  // Wrapped in $state because Svelte 5 needs the binding to be reactive
  // for the post-mount `await tick()` -> wire-up flow to see the populated
  // value (otherwise we'd race the render and `panelEl` would be undefined).
  let panelEl = $state(null);
  let stepsLen = $state(0);
  let stepsReady = $state(false);

  // v2 (single-hero model): exactly one seat per hand can be red,
  // pulled from the canonical row's `hero_seat` column. We store it as
  // a Set with 0 or 1 element so the renderSeats helper keeps its
  // membership-test API.
  let redSeats = new Set();

  // ---------------------------------------------------------- module load

  async function ensureEngine() {
    if (window.CasinoReplay && window.CasinoCards && window.CasinoTableize) return;
    async function loadScript(src) {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`failed to load ${src}`));
        document.head.appendChild(s);
      });
    }
    // tableize first — replay.js reads CasinoTableize.AUTHORITATIVE_ACTIONS
    // at module-init time.
    await loadScript("/replay-engine/tableize.js");
    await loadScript("/replay-engine/cards.js");
    await loadScript("/replay-engine/users.js");
    await loadScript("/replay-engine/replay.js");
  }

  // ------------------------------------------------------- ext code shims

  // The extension's renderer code references a handful of globals from
  // history.js. We provide trimmed-down equivalents here.
  //
  //   Cards     -> window.CasinoCards (from cards.js)
  //   ReplayMod -> window.CasinoReplay (from replay.js)
  //
  // The extension also reads from `Users` (users.js) and a `state.userIndex`
  // global to map userId -> display name / avatar. The website doesn't
  // expose either (avatars aren't part of the canonical bytes), so
  // `fallbackName` and `avatarFor` below short-circuit to seat-based
  // labels. We deliberately do NOT introduce a local `state` variable
  // here — Svelte 5 treats `state` as ambiguous with the `$state` rune,
  // so any local binding called `state` rewrites every `$state(...)`
  // call on the page into `state(...)` and breaks reactivity.
  const Cards = () => window.CasinoCards;
  const ReplayMod = () => window.CasinoReplay;

  // ------------------------------------------------------ ext code: utils

  // escapeHtml — character-for-character from history.js#escapeHtml.
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ------------------------------------------- ext code: seat metadata

  // From history.js — verbatim.
  function fallbackName(seat) {
    if (seat.userId != null) {
      // Users module isn't loaded on the website (no userIndex from the
      // server); skip the lookup and produce a stable label.
      return `User ${seat.userId}`;
    }
    return `Seat ${seat.seatId}`;
  }

  function avatarFor(seat) {
    // Website doesn't ship per-user avatars (no Users module). The seat
    // icon falls back to a numeric badge in renderSeats.
    return null;
  }

  // v2: single-hero. We seed `out` from `redSeats` (the server-stamped
  // hero_seat for this row) and don't sniff `dealHoleCards` for extra
  // seats — multi-hero is intentionally OFF. Returns a Set so the
  // renderSeats `.has()` API is preserved.
  function detectHeroSeats(_round) {
    return new Set(redSeats);
  }

  // From history.js — verbatim.
  const ACTING_STEPS = new Set(["check", "call", "bet", "raise", "fold", "allIn"]);
  function actingSeatForStep(step) {
    if (!step || !ACTING_STEPS.has(step.action)) return null;
    const sid = step.update && step.update.seatId;
    return sid != null ? Number(sid) : null;
  }

  // From history.js — verbatim.
  function seatPositions(count) {
    const layouts = {
      1: [[50, 82]],
      2: [[50, 82], [50, 18]],
      3: [[50, 82], [18, 48], [82, 48]],
      4: [[50, 82], [18, 56], [50, 18], [82, 56]],
      5: [[50, 84], [18, 64], [25, 24], [75, 24], [82, 64]],
      6: [[50, 84], [18, 64], [22, 24], [50, 16], [78, 24], [82, 64]],
      7: [[50, 86], [18, 68], [18, 38], [35, 18], [65, 18], [82, 38], [82, 68]],
      8: [[50, 86], [20, 70], [18, 42], [32, 20], [68, 20], [82, 42], [80, 70], [50, 16]],
      9: [[50, 86], [18, 72], [18, 48], [25, 22], [40, 14], [60, 14], [75, 22], [82, 48], [82, 72]]
    };
    return layouts[Math.min(9, Math.max(1, count))] || layouts[9];
  }

  // From history.js — verbatim.
  function actionPillLabel(action, chips) {
    const name = ({
      check: "CHECK",
      call: "CALL",
      bet: "BET",
      raise: "RAISE",
      fold: "FOLD",
      allIn: "ALL IN",
      show: "SHOW",
      muck: "MUCK"
    })[action] || String(action).toUpperCase();
    if (chips && Number.isFinite(chips) && chips > 0
        && (action === "call" || action === "bet" || action === "raise" || action === "allIn")) {
      return `${name} ${chips}`;
    }
    return name;
  }

  // From history.js — verbatim except for the chip image path: the
  // extension serves `assets/chipN.png` relative to the page; we serve it
  // from `/replay-engine/assets/chipN.png` (absolute) so the URL resolves
  // the same way regardless of which route is hosting the panel.
  const CHIP_DENOMS = [25000, 5000, 1000, 500, 100, 25, 5, 1];
  const CHIP_STACK_CAP = 8;
  function chipBreakdown(amount) {
    let n = Math.max(0, Math.floor(Number(amount) || 0));
    const out = [];
    for (const d of CHIP_DENOMS) {
      if (n >= d) {
        const count = Math.floor(n / d);
        n -= count * d;
        out.push({ denom: d, count });
      }
    }
    return out;
  }
  function chipStackHtml(amount) {
    const breakdown = chipBreakdown(amount);
    if (breakdown.length === 0) return "";
    const columns = breakdown.map((b, i) => {
      const visible = Math.min(b.count, CHIP_STACK_CAP);
      const overflow = b.count - visible;
      const chips = [];
      for (let k = 0; k < visible; k++) {
        const src = `/replay-engine/assets/chip${b.denom}.png`;
        chips.push(`<img class="chip" src="${escapeHtml(src)}" alt="" style="--k:${k};" draggable="false"/>`);
      }
      const overflowBadge = overflow > 0
        ? `<span class="chip-stack-overflow">+${overflow}</span>`
        : "";
      const parity = (i % 2 === 0) ? "low" : "high";
      return `<span class="chip-col chip-col-${parity}" data-denom="${b.denom}" data-count="${b.count}">
          ${chips.join("")}
          ${overflowBadge}
        </span>`;
    });
    return `<span class="chip-stack" aria-hidden="true">${columns.join("")}</span>`;
  }

  // From history.js — modified ONLY to take a `heroSeats` SET instead of
  // a scalar `heroSeat`, so 0/1/N seats can be marked red.
  function renderSeats(snap, peekCache, ctx) {
    ctx = ctx || {};
    const heroSeats = ctx.heroSeats || new Set();
    const actingSeat = ctx.actingSeat != null ? Number(ctx.actingSeat) : null;
    const currentStep = ctx.currentStep || null;
    const currentChips = currentStep && currentStep.update && Number.isFinite(currentStep.update.chips)
      ? currentStep.update.chips
      : null;

    const occupied = Object.values(snap.seats)
      .filter((s) => s.state !== "away"
                  && (s.userId != null
                      || s.state === "playing"
                      || s.state === "sitOut"
                      || (Array.isArray(s.cards) && s.cards.length)))
      .sort((a, b) => a.seatId - b.seatId);

    if (occupied.length === 0) return "";

    const positions = seatPositions(occupied.length);

    return occupied.map((seat, i) => {
      const [x, y] = positions[i] || [50, 50];
      let orient;
      const dxCenter = Math.abs(x - 50);
      const dyCenter = Math.abs(y - 50);
      if (dxCenter > dyCenter) {
        orient = (x < 50) ? "left" : "right";
      } else {
        orient = (y > 50) ? "down" : "up";
      }

      const peekable = peekCache.has(seat.seatId);
      let cardsHtml = "";
      if (Array.isArray(seat.cards)) {
        cardsHtml = `
          <div class="seat-cards">
            ${cardHtml(seat.cards[0], { peekable, seatId: seat.seatId, cardIdx: 0 })}
            ${cardHtml(seat.cards[1], { peekable, seatId: seat.seatId, cardIdx: 1 })}
          </div>`;
      }

      let actionPill;
      if (seat.lastAction) {
        const cls = `action-${seat.lastAction}`;
        const chips = (actingSeat === seat.seatId) ? currentChips : null;
        actionPill = `<span class="seat-action ${cls}">${escapeHtml(actionPillLabel(seat.lastAction, chips))}</span>`;
      } else if (seat.state === "sitOut") {
        actionPill = `<span class="seat-action action-fold">SIT OUT</span>`;
      } else {
        actionPill = `<span class="seat-action placeholder" aria-hidden="true">·</span>`;
      }

      let betHtml = "";
      if (seat.bet > 0) {
        betHtml = `<div class="seat-bet" title="Bet">
             <span class="seat-bet-amount">${escapeHtml(String(seat.bet))}</span>
             ${chipStackHtml(seat.bet)}
           </div>`;
      } else if ((seat.winnings || 0) > 0 || (seat.refund || 0) > 0) {
        const parts = [];
        if ((seat.refund || 0) > 0) {
          parts.push(`<div class="seat-bet seat-bet-refund" title="Refund">
             <span class="seat-bet-amount">+${escapeHtml(String(seat.refund))}</span>
             ${chipStackHtml(seat.refund)}
           </div>`);
        }
        if ((seat.winnings || 0) > 0) {
          parts.push(`<div class="seat-bet seat-bet-winnings" title="Winnings">
             <span class="seat-bet-amount">+${escapeHtml(String(seat.winnings))}</span>
             ${chipStackHtml(seat.winnings)}
           </div>`);
        }
        betHtml = parts.join("");
      }

      const dealer = (seat.seatId === snap.dealerSeat)
        ? `<span class="seat-dealer" aria-label="Dealer">D</span>`
        : "";

      const winnerCls = seat.winnings > 0 ? " seat-winner" : "";
      const refundCls = (seat.refund || 0) > 0 && seat.winnings <= 0 ? " seat-refund" : "";
      const foldedCls = seat.folded ? " folded" : "";
      const heroCls = heroSeats.has(Number(seat.seatId)) ? " hero" : "";
      const actingCls = (actingSeat != null && seat.seatId === actingSeat) ? " acting" : "";
      const sitOutCls = seat.state === "sitOut" ? " sit-out" : "";
      const allInCls = seat.allIn ? " all-in" : "";

      const avatar = avatarFor(seat);
      const avatarHtml = avatar
        ? `<img class="seat-avatar-img" src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'seat-avatar-fallback',textContent:'?'}))"/>`
        : `<span class="seat-avatar-fallback" aria-hidden="true">${escapeHtml(String(seat.seatId))}</span>`;

      const cardsBlock = cardsHtml || `<div class="seat-cards empty" aria-hidden="true"></div>`;
      return `
        <div class="felt-seat orient-${orient}${heroCls}${actingCls}${foldedCls}${sitOutCls}${allInCls}${refundCls}${winnerCls}"
             style="--x:${x}%; --y:${y}%;"
             data-seat-id="${seat.seatId}">
          <div class="seat-icon">${avatarHtml}</div>
          <div class="seat-name-plate">
            <span class="seat-name" title="seat ${seat.seatId}">${escapeHtml(fallbackName(seat))}</span>
            <span class="seat-stack">${seat.stack != null ? escapeHtml(String(seat.stack)) : "\u2014"}</span>
            ${actionPill}
          </div>
          ${cardsBlock}
          ${betHtml}
          ${dealer}
        </div>`;
    }).join("");
  }

  // From history.js — verbatim.
  function cardHtml(face, opts) {
    opts = opts || {};
    const C = Cards();
    if (C) {
      const dataAttrs = [];
      if (opts.peekable) dataAttrs.push({ name: "data-peekable", value: "1" });
      if (opts.seatId != null) dataAttrs.push({ name: "data-seat-id", value: opts.seatId });
      if (opts.cardIdx != null) dataAttrs.push({ name: "data-card-idx", value: opts.cardIdx });
      if (opts.boardIdx != null) dataAttrs.push({ name: "data-board-idx", value: opts.boardIdx });
      return C.render(face || "X", {
        hidden: !face || face === "X",
        peekable: !!opts.peekable,
        dataAttrs
      });
    }
    const txt = face && face !== "X" ? face : "X";
    return `<span class="card-wrap"><span class="card-fallback">${escapeHtml(txt)}</span></span>`;
  }

  // From history.js — verbatim.
  function indexBoardRevelations(round) {
    const out = [];
    if (!round || !Array.isArray(round.steps)) return out;
    for (const step of round.steps) {
      if (step.action !== "dealCommunityCards") continue;
      const cards = step.update && Array.isArray(step.update.cards) ? step.update.cards : null;
      if (!cards) continue;
      for (const c of cards) {
        if (out.length >= 5) break;
        out.push(c);
      }
      if (out.length >= 5) break;
    }
    return out;
  }

  // From history.js — adapted to read the slot from our local variable
  // (instead of `state.replays.get(key)`).
  function renderPanel() {
    if (!slot || !slot.panel) return;
    const { engine, round, panel } = slot;
    const snap = engine.snapshot();
    const step = engine.currentStep();

    // Hero set (0..N) — resolved once per render rather than once per
    // round because perspective rows can grow if more uploads land while
    // the panel is open. (Currently the website doesn't live-update, but
    // it's cheap to recompute.)
    if (!slot.heroSeats) slot.heroSeats = detectHeroSeats(round);
    const actingSeat = actingSeatForStep(step);

    slot.boardRevelations = indexBoardRevelations(round);

    if (slot.peekCache && engine.revealed) {
      for (const [sid, cards] of engine.revealed) {
        slot.peekCache.set(Number(sid), cards);
      }
    }

    const potEl = panel.querySelector(".replay-pot");
    const potValue = snap.pot || 0;
    potEl.innerHTML = `
      <span class="pot-pill"><span class="pot-label">Pot</span>${escapeHtml(String(potValue))}</span>
      ${chipStackHtml(potValue)}`;

    const boardEl = panel.querySelector(".replay-board");
    const boardHtml = [];
    for (let i = 0; i < 5; i++) {
      if (i < snap.board.length) {
        boardHtml.push(cardHtml(snap.board[i], { boardIdx: i }));
      } else {
        const future = slot.boardRevelations[i];
        const peekable = !!(future && future !== "X");
        boardHtml.push(cardHtml(null, { peekable, boardIdx: i }));
      }
    }
    boardEl.innerHTML = boardHtml.join("");

    const seatsEl = panel.querySelector(".replay-seats");
    seatsEl.innerHTML = renderSeats(snap, slot.peekCache, {
      heroSeats: slot.heroSeats,
      actingSeat,
      currentStep: step
    });

    panel.querySelector(".replay-step-label").textContent = step
      ? ReplayMod().stepLabel(step)
      : "Before deal";

    panel.querySelector(".replay-prev").disabled = engine.cursor < 0;
    panel.querySelector(".replay-next").disabled = engine.cursor >= engine.length() - 1;

    const scrub = panel.querySelector(".replay-scrubber");
    if (Number(scrub.max) !== engine.length() - 1) {
      scrub.max = String(Math.max(0, engine.length() - 1));
      renderTicks(panel, round);
    }
    const cursor = Math.max(0, engine.cursor);
    if (Number(scrub.value) !== cursor) scrub.value = String(cursor);
  }

  // From history.js — verbatim.
  function renderTicks(panel, round) {
    const ticksEl = panel.querySelector(".replay-ticks");
    const n = round.steps.length;
    if (n <= 0) { ticksEl.innerHTML = ""; return; }

    let dealsSeen = 0;
    const labelByIdx = new Array(n).fill("");
    for (let i = 0; i < n; i++) {
      const s = round.steps[i];
      if (!s.milestone) continue;
      if (s.action === "dealCommunityCards") {
        dealsSeen++;
        if (dealsSeen === 1) labelByIdx[i] = "Flop";
        else if (dealsSeen === 2) labelByIdx[i] = "Turn";
        else if (dealsSeen === 3) labelByIdx[i] = "River";
        else labelByIdx[i] = "Board";
      } else {
        labelByIdx[i] = shortMilestoneLabel(s);
      }
    }

    const html = round.steps.map((s, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * 100;
      const cls = s.milestone ? "replay-tick milestone" : "replay-tick";
      const label = s.milestone && labelByIdx[i]
        ? `<span class="replay-tick-label" style="left:${x}%;">${escapeHtml(labelByIdx[i])}</span>`
        : "";
      return `<span class="${cls}" style="left:${x}%;"></span>${label}`;
    }).join("");
    ticksEl.innerHTML = html;
  }

  // From history.js — verbatim.
  function shortMilestoneLabel(step) {
    switch (step.action) {
      case "startHand":     return "Start";
      case "dealHoleCards": return "Deal";
      case "showdown":      return "Showdown";
      case "awardPot":      return "Award";
      case "finishHand":    return "End";
      default:              return "";
    }
  }

  // ---------------------------------------------------- card peek (clicks)
  //
  // From history.js — `peekCard`, `lookupHiddenFace`, `shakeUnknownCard`,
  // verbatim. Wrapped click delegation is bound to our `panelEl` so two
  // open panels on the same page don't fight over the same click events.

  const peekTimers = new WeakMap();

  function lookupHiddenFace(wrapEl, s) {
    if (wrapEl.dataset.boardIdx != null) {
      const i = Number(wrapEl.dataset.boardIdx);
      if (s.boardRevelations && Number.isFinite(i)) {
        const f = s.boardRevelations[i];
        return f && f !== "X" ? f : null;
      }
    } else if (wrapEl.dataset.seatId != null) {
      const seatId = Number(wrapEl.dataset.seatId);
      const cardIdx = Number(wrapEl.dataset.cardIdx);
      const cards = s.peekCache.get(seatId);
      if (cards && Number.isFinite(cardIdx)) {
        const f = cards[cardIdx];
        return f && f !== "X" ? f : null;
      }
    }
    return null;
  }

  function peekCard(wrapEl, s) {
    if (wrapEl.dataset.peeking === "1") return;
    const face = lookupHiddenFace(wrapEl, s);
    if (!face) {
      shakeUnknownCard(wrapEl);
      return;
    }
    const C = Cards();
    if (!C) return;
    if (peekTimers.has(wrapEl)) {
      clearTimeout(peekTimers.get(wrapEl));
      peekTimers.delete(wrapEl);
    }
    wrapEl.dataset.peeking = "1";
    C.flip(wrapEl, face, { peekable: true, hidden: false }).then(() => {
      peekTimers.set(wrapEl, setTimeout(() => {
        if (!wrapEl.isConnected) {
          peekTimers.delete(wrapEl);
          return;
        }
        C.flip(wrapEl, "X", { peekable: true, hidden: true }).then(() => {
          delete wrapEl.dataset.peeking;
          peekTimers.delete(wrapEl);
        });
      }, 1000));
    });
  }

  function shakeUnknownCard(wrapEl) {
    if (wrapEl.dataset.peeking === "1") return;
    wrapEl.dataset.peeking = "1";
    const duration = 950;
    const startTs = performance.now();
    const amplitude = 8;
    const frequency = 7;
    wrapEl.style.transformOrigin = "50% 50%";
    wrapEl.style.willChange = "transform";
    function frame(now) {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / duration);
      const x = amplitude * (1 - t) * Math.sin(2 * Math.PI * frequency * t);
      wrapEl.style.transform = `translateX(${x.toFixed(2)}px)`;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        wrapEl.style.transform = "";
        wrapEl.style.willChange = "";
        delete wrapEl.dataset.peeking;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------- build flow

  async function build() {
    try {
      loading = true;
      error = null;
      await ensureEngine();
      const res = await fetch(`/data/hand/${encodeURIComponent(handKey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload = await res.json();

      // v2: single hero. Build a one-element perspective list out of
      // the canonical row's hero_seat + hero_hole_cards so the existing
      // patch-cards / red-highlight code paths keep their shape.
      const singleHero = (payload.heroSeat != null && Array.isArray(payload.heroHoleCards))
        ? [{ seatId: Number(payload.heroSeat), holeCards: payload.heroHoleCards }]
        : [];
      patchHoleCards(payload.frames, singleHero);

      const container = {
        frames: payload.frames,
        tableId: payload.tableId,
        tableName: (payload.tableNames || []).slice().reverse().join(" - "),
        pageTitle: null
      };
      const round = ReplayMod().buildSteps(container, 0);
      const engine = new (ReplayMod().Replay)(round);

      // Single red seat for v2 — see `let redSeats` above.
      redSeats = new Set(singleHero.map((p) => p.seatId));

      stepsLen = round.steps.length;
      stepsReady = stepsLen > 0;
      loading = false;

      if (!stepsReady) return;

      // Wait for {#if !loading && stepsReady} to render the template
      // skeleton into the DOM before we wire it up.
      await tick();
      if (!panelEl) return;

      const peekCache = new Map();
      for (const [sid, cards] of engine.revealed) {
        peekCache.set(Number(sid), cards);
      }

      slot = {
        engine,
        round,
        panel: panelEl,
        peekCache,
        heroSeats: null,
        boardRevelations: []
      };

      // Headline
      const tableLabel = container.tableName
        ? `${container.tableName} \u00b7 #${container.tableId}`
        : `Table #${container.tableId}`;
      // Generic rows (admin spectator uploads) carry the synthetic
      // [Generic] player name; render those as "spectator view"
      // instead of the literal "[Generic]'s perspective".
      let playerLabel = "";
      if (payload.player && payload.player.name) {
        playerLabel = payload.player.name === "[Generic]"
          ? " \u00b7 spectator view"
          : ` \u00b7 ${payload.player.name}'s perspective`;
      }
      panelEl.querySelector(".replay-title").textContent =
        `Hand ${payload.handId || "(no id)"}`;
      panelEl.querySelector(".replay-subtitle").textContent =
        `${tableLabel}${playerLabel} \u00b7 ${round.steps.length} step${round.steps.length === 1 ? "" : "s"}`;

      // Scrubber bounds.
      const scrub = panelEl.querySelector(".replay-scrubber");
      scrub.min = "0";
      scrub.max = String(round.steps.length - 1);
      scrub.step = "1";
      scrub.value = "0";

      renderTicks(panelEl, round);

      panelEl.querySelector(".replay-prev").addEventListener("click", () => {
        engine.prev();
        renderPanel();
      });
      panelEl.querySelector(".replay-next").addEventListener("click", () => {
        engine.next();
        renderPanel();
      });
      scrub.addEventListener("input", () => {
        engine.goto(Number(scrub.value));
        renderPanel();
      });

      panelEl.addEventListener("click", (e) => {
        const cardWrap = e.target.closest(".card-wrap.hidden");
        if (!cardWrap) return;
        peekCard(cardWrap, slot);
      });

      panelEl.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); engine.next(); renderPanel(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); engine.prev(); renderPanel(); }
      });

      // Skip to the dealHoleCards step so the panel opens with cards
      // already dealt (matches the extension).
      const dealIdx = round.steps.findIndex((s) => s.action === "dealHoleCards");
      engine.goto(dealIdx >= 0 ? dealIdx : 0);
      renderPanel();
    } catch (e) {
      error = e.message || String(e);
      loading = false;
    }
  }

  // Replace masked ["X","X"] hole cards in `dealHoleCards` updates
  // with the perspective's real cards. Real frames carry the seat
  // list under `players[]`, NOT `seats[]` (DATA_FORMAT.md §4.2 +
  // replay.js#dealHoleCards). The legacy `seats[]` branch stays for
  // any old envelope shape we still want to render.
  function patchHoleCards(frames, perspectives) {
    const byId = new Map();
    for (const p of perspectives) {
      if (p.seatId != null && Array.isArray(p.holeCards)) {
        byId.set(Number(p.seatId), p.holeCards);
      }
    }
    if (byId.size === 0) return;
    for (const f of frames) {
      if (!f || f.event !== "output") continue;
      const updates = f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
      if (!updates) continue;
      for (const u of updates) {
        if (!u || u.action !== "dealHoleCards") continue;
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            if (!p || p.seatId == null) continue;
            const real = byId.get(Number(p.seatId));
            if (real) p.cards = real.slice(0, 2);
          }
        }
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            const sid = s.seatId ?? s.id;
            if (sid == null) continue;
            const real = byId.get(Number(sid));
            if (real) s.cards = real.slice(0, 2);
          }
        }
      }
    }
  }

  onMount(build);
</script>

{#if loading}
  <p class="muted">Loading replay…</p>
{:else if error}
  <p class="form-error">Couldn't load replay: {error}</p>
{:else if !stepsReady}
  <p class="muted">No replayable steps in this hand.</p>
{:else}
  <!-- Template structure matches casinoMalwareExtension/history.html
       (the <template id="replayTemplate"> block), so every CSS rule in
       /replay-engine/replay-felt.css matches exactly. The renderer code
       above walks this DOM by class name and fills it in. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="replay-inline" bind:this={panelEl} tabindex="0">
    <div class="replay-topline">
      <div class="replay-headline">
        <!-- svelte-ignore a11y_missing_content -->
        <h3 class="replay-title"></h3>
        <span class="replay-subtitle"></span>
      </div>
      <span class="replay-step-label" aria-live="polite"></span>
    </div>

    <div class="replay-felt-wrap">
      <div class="replay-felt">
        <div class="felt-watermark" aria-hidden="true">
          <img src="/replay-engine/assets/holdem.png" alt="" />
        </div>
        <div class="felt-pot replay-pot"></div>
        <div class="felt-board replay-board"></div>
        <div class="felt-seats replay-seats"></div>
      </div>
    </div>

    <div class="replay-controls">
      <button type="button" class="replay-step-btn replay-prev" aria-label="Previous step">‹ Prev</button>
      <div class="replay-scrubber-wrap">
        <div class="replay-ticks" aria-hidden="true"></div>
        <input class="replay-scrubber" type="range" min="0" max="0" value="0" step="1" aria-label="Scrub round" />
      </div>
      <button type="button" class="replay-step-btn replay-next" aria-label="Next step">Next ›</button>
    </div>
  </div>

  <!-- Website-only addition: list of uploaders that contributed to this
       canonical hand. Hidden by default; click to expand. -->
  <details class="contributors">
    <summary class="muted">{payload.uploads.length} upload{payload.uploads.length === 1 ? "" : "s"} contributed</summary>
    <ul>
      {#each payload.uploads as u}
        <li>
          Seat {u.seatId ?? "?"}
          {#if u.uploader} — <strong>{u.uploader}</strong>{:else} — anonymous{/if}
          {#if u.isCanonical} <span class="badge">canonical</span>{/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  /* The felt itself + all its descendants (seats, chips, pot, board,
     scrubber, ticks) are styled by /replay-engine/replay-felt.css. We
     only style the website-only "contributors" disclosure below it. */
  .contributors { margin-top: 10px; }
  .contributors ul { margin: 6px 0 0 18px; padding: 0; font-size: 12px; }
  .badge {
    display: inline-block;
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px;
    text-transform: uppercase;
    padding: 1px 6px; border-radius: 999px;
    color: var(--ok); background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.35);
    margin-left: 4px;
  }
</style>
