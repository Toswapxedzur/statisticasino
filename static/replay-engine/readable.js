// Readable JSON exporter — shared shape across extension + website.
//
// Input: a `round` (the output of CasinoReplay.buildSteps) plus an
// optional perspective hint { name, casinoUserId, seatId, holeCards }.
// Output: a JS object representing one round in the canonical
// readable form:
//
//   {
//     handId, firstTs, lastTs,
//     hero: { name, casinoUserId, seatId, holeCards } | null,
//     actions: [
//       { step, action, ...flattened semantic fields }
//     ]
//   }
//
// We deliberately do NOT include the raw WebSocket payload — per
// chat 2026-05-21 the user wants "merged actions, not the full
// payload". Each action is one merged authoritative step with just
// its semantic fields surfaced.
//
// This module hangs `globalThis.CasinoReadable` so it's reachable
// from both the extension's history.js and (via the
// /replay-engine/readable.js mirror) from the statisticasino site.

(function (root) {
  // Minimal seat extractor — pulls { seatId, cards? } from a player
  // entry inside an `update.players[]` array.
  function pickSeats(arr) {
    if (!Array.isArray(arr)) return undefined;
    return arr
      .map((p) => p && p.seatId != null
        ? { seatId: Number(p.seatId), cards: Array.isArray(p.cards) ? p.cards.slice(0, 2) : undefined }
        : null)
      .filter(Boolean);
  }

  function pickPots(arr) {
    if (!Array.isArray(arr)) return undefined;
    return arr.map((p) => ({
      chips: Number(p && p.chips || 0),
      seatIds: Array.isArray(p && p.seatIds) ? p.seatIds.slice() : []
    }));
  }

  // Translate one merged step into a flattened, human-readable
  // action object. The big switch is intentional — each action
  // type has its own canonical fields, and burying them under a
  // generic "payload" defeats the readability goal.
  function flattenStep(step, idx) {
    const u = step && step.update || {};
    const action = step && step.action || u.action || "?";
    const out = { step: idx + 1, action };
    if (step && step.ts != null) out.ts = step.ts;

    switch (action) {
      case "startHand": {
        if (u.id != null) out.handId = String(u.id);
        if (u.dealerSeat != null) out.dealerSeat = Number(u.dealerSeat);
        const seats = Array.isArray(u.seats) ? u.seats.map((s) => ({
          seatId: Number(s.id ?? s.seatId),
          userId: s.userId != null ? Number(s.userId) : null,
          stack: s.stack != null ? Number(s.stack) : null,
          state: s.state || null
        })) : null;
        if (seats) out.seats = seats;
        break;
      }
      case "blinds": {
        // blinds payloads carry chip costs per seat under various
        // shapes; the most reliable is `players[]` snapshots, but
        // some servers stamp `smallBlind` / `bigBlind` directly.
        if (u.smallBlind && u.smallBlind.seatId != null) {
          out.smallBlind = { seatId: Number(u.smallBlind.seatId), chips: Number(u.smallBlind.chips || 0) };
        }
        if (u.bigBlind && u.bigBlind.seatId != null) {
          out.bigBlind = { seatId: Number(u.bigBlind.seatId), chips: Number(u.bigBlind.chips || 0) };
        }
        const pl = pickSeats(u.players);
        if (pl) out.playersBet = pl.map((p) => ({ seatId: p.seatId }));
        break;
      }
      case "dealHoleCards": {
        const seats = pickSeats(u.players);
        if (seats) out.seats = seats;
        break;
      }
      case "dealCommunityCards": {
        if (Array.isArray(u.cards)) out.cards = u.cards.slice();
        if (u.street) out.street = u.street;
        break;
      }
      case "check":
      case "call":
      case "bet":
      case "raise":
      case "fold":
      case "allIn": {
        if (u.seatId != null) out.seatId = Number(u.seatId);
        if (u.chips != null) out.chips = Number(u.chips);
        break;
      }
      case "updatePots": {
        const pots = pickPots(u.pots);
        if (pots) out.pots = pots;
        break;
      }
      case "betRefund": {
        if (u.seatId != null) out.seatId = Number(u.seatId);
        if (u.chips != null) out.chips = Number(u.chips);
        break;
      }
      case "showdown": {
        if (Array.isArray(u.seatIds)) out.seatIds = u.seatIds.map(Number);
        break;
      }
      case "show": {
        if (u.seatId != null) out.seatId = Number(u.seatId);
        if (Array.isArray(u.cards)) out.cards = u.cards.slice(0, 2);
        if (u.handStrength) out.handStrength = u.handStrength;
        break;
      }
      case "muck": {
        if (u.seatId != null) out.seatId = Number(u.seatId);
        break;
      }
      case "awardPot": {
        const pls = Array.isArray(u.players) ? u.players.map((p) => ({
          seatId: p.seatId != null ? Number(p.seatId) : null,
          chips: p.chips != null ? Number(p.chips) : null,
          handStrength: p.handStrength || null
        })).filter((p) => p.seatId != null) : null;
        if (pls) out.winners = pls;
        break;
      }
      case "finishHand": {
        const seats = Array.isArray(u.players) ? u.players.map((p) => ({
          seatId: p.seatId != null ? Number(p.seatId) : null,
          stack: p.stack != null ? Number(p.stack) : null
        })).filter((p) => p.seatId != null) : null;
        if (seats) out.finalStacks = seats;
        break;
      }
      default:
        // Unknown / non-authoritative — leave just { step, action }.
        break;
    }
    return out;
  }

  // Build the per-round payload. `round` is the buildSteps output;
  // `hero` is { name, casinoUserId, seatId, holeCards } or null.
  // `extra` is { firstTs, lastTs } overrides since `round.steps`
  // doesn't carry them at top level.
  function buildRoundReadable(round, hero, extra) {
    extra = extra || {};
    const steps = (round && round.steps) || [];
    return {
      handId: round && round.handId ? String(round.handId) : null,
      firstTs: extra.firstTs != null ? extra.firstTs
        : (steps.length ? steps[0].ts : null),
      lastTs: extra.lastTs != null ? extra.lastTs
        : (steps.length ? steps[steps.length - 1].ts : null),
      hero: hero || null,
      actions: steps.map(flattenStep)
    };
  }

  // Group an array of { player, table, round } items into the
  // top-level export shape. `rounds[i].player` is { name | null,
  // casinoUserId | null }; `rounds[i].table` is { tableId, names }.
  function buildExport(rounds) {
    const players = new Map(); // playerKey -> { name, casinoUserId, tables: Map<tableId, table> }
    function playerKey(p) {
      if (!p || (p.name == null && p.casinoUserId == null)) return "__unknown__";
      return `${p.name == null ? "" : p.name}::${p.casinoUserId == null ? "" : p.casinoUserId}`;
    }
    for (const r of rounds) {
      const pk = playerKey(r.player);
      let pe = players.get(pk);
      if (!pe) {
        pe = {
          name: r.player ? (r.player.name == null ? null : r.player.name) : null,
          casinoUserId: r.player ? (r.player.casinoUserId == null ? null : r.player.casinoUserId) : null,
          tables: new Map()
        };
        players.set(pk, pe);
      }
      const tk = String(r.table.tableId);
      let te = pe.tables.get(tk);
      if (!te) {
        te = {
          tableId: tk,
          tableNames: Array.isArray(r.table.names) ? r.table.names.slice() : null,
          rounds: []
        };
        pe.tables.set(tk, te);
      }
      te.rounds.push(r.round);
    }
    return {
      v: 1,
      format: "casino-readable-export",
      exportedTs: Date.now(),
      players: Array.from(players.values()).map((pe) => ({
        name: pe.name,
        casinoUserId: pe.casinoUserId,
        tables: Array.from(pe.tables.values())
      }))
    };
  }

  root.CasinoReadable = {
    flattenStep,
    buildRoundReadable,
    buildExport
  };
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
