// Perspective-owner detection.
//
// The poker server only deals real hole cards to the seat owned by the
// connected user; every other seat shows ["X","X"] in `dealHoleCards`.
// So the seat with a fully-resolved card pair after `dealHoleCards` is
// the upload's perspective owner.
//
// v2 (2026-05-21): single hero only. The multi-hero union model from
// v1 is gone; we never store more than one perspective per row.
//
// Wire-format reference (DATA_FORMAT.md §4.2 + casinoMalwareExtension/
// replay.js, which is the source of truth for what real frames look
// like):
//
//   * `startHand` payload:
//       { action:"startHand", id, dealerSeat,
//         seats:   [ { id, userId, stack, state, ... }, ... ],
//         players: [ { seatId, ... }, ... ] }
//     Note that on the `startHand` action the seat key is `id`, NOT
//     `seatId`. This bit me; keeping it commented loudly.
//
//   * `dealHoleCards` payload:
//       { action:"dealHoleCards",
//         players: [ { seatId, cards: ["Ah","Kd"] | ["X","X"] }, ... ] }
//     ALWAYS `players[]`, NOT `seats[]`. (My initial server impl
//     read `seats[]` and was rejecting every real upload as
//     "generic" — chat 2026-05-21.)
//
//   * Per-action commit payloads (`bet` / `call` / `raise` / `fold` /
//     `dealCommunityCards` / `updatePots` / etc.):
//       { action, seatId, ..., players: [ { seatId, ... }, ... ],
//         seats?: [ { id, userId, ... }, ... ] }
//
// The detectors below accept BOTH shapes (`players[]` and `seats[]`)
// so the synthetic test envelopes I wrote for smoke-ingest.js still
// pass — but production frames flow through the `players[]` branch.

const MASK = new Set(["X", "x", "?", ""]);

function isMaskedCard(c) {
  return c == null || MASK.has(String(c));
}

function isRealPair(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return false;
  return !isMaskedCard(cards[0]) && !isMaskedCard(cards[1]);
}

// Walk the envelope's frames, find the FIRST `dealHoleCards` update,
// and return { seatId, holeCards }. Returns null when no qualifying
// seat exists -> caller should reject as "generic".
//
// Reads `u.players[]` first (real shape), then `u.seats[]` (legacy /
// synthetic), then a flat `{ u.seatId, u.cards }` (very rare).
export function detectPerspective(envelope) {
  if (!envelope || !Array.isArray(envelope.frames)) return null;
  for (const f of envelope.frames) {
    if (!f || f.event !== "output") continue;
    const updates = f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
    if (!updates) continue;
    for (const u of updates) {
      if (!u || u.action !== "dealHoleCards") continue;
      if (Array.isArray(u.players)) {
        for (const p of u.players) {
          if (p && p.seatId != null && isRealPair(p.cards)) {
            return { seatId: Number(p.seatId), holeCards: p.cards.slice(0, 2) };
          }
        }
      }
      if (Array.isArray(u.seats)) {
        for (const s of u.seats) {
          if (!s) continue;
          // On `dealHoleCards` synthetic test frames the seat key is
          // `seatId`. On other actions (`startHand`, `updatePots`, ...)
          // it's `id`. Accept both.
          const sid = s.seatId ?? s.id;
          if (sid != null && isRealPair(s.cards)) {
            return { seatId: Number(sid), holeCards: s.cards.slice(0, 2) };
          }
        }
      }
      if (u.seatId != null && isRealPair(u.cards)) {
        return { seatId: Number(u.seatId), holeCards: u.cards.slice(0, 2) };
      }
      // Only the FIRST dealHoleCards counts — opponents `show` later
      // at showdown and we don't want THAT counted as a perspective
      // claim.
      return null;
    }
  }
  return null;
}

// Walk the envelope's frames looking for a seat snapshot that names
// `seatId -> userId`. Real frames carry the pair on:
//
//   * updates[].seats[]   ({ id|seatId, userId })   — startHand /
//                                                     updatePots / state-style
//   * updates[].players[] ({ seatId, userId? })     — most actions
//   * updates[]           ({ action:"seat", seatId, userId, ... })
//   * payload.seats[]                                — top-level state event
//
// `payload.seats[]` is rare in our captured slice (we keep `output`
// frames mostly), but cheap to check.
export function resolveSeatUserId(envelope, targetSeatId) {
  if (!envelope || targetSeatId == null) return null;
  const frames = Array.isArray(envelope.frames) ? envelope.frames : [];
  const target = Number(targetSeatId);

  function maybeUid(node) {
    if (!node || typeof node !== "object") return null;
    // Accept either { id, ... } or { seatId, ... } as the seat-id key.
    const sid = node.seatId ?? node.id;
    if (sid == null || Number(sid) !== target) return null;
    const uid = node.userId ?? node.user_id;
    if (uid == null) return null;
    const n = Number(uid);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  for (const f of frames) {
    const payload = f && f.payload;
    if (!payload || typeof payload !== "object") continue;

    if (Array.isArray(payload.seats)) {
      for (const s of payload.seats) {
        const hit = maybeUid(s);
        if (hit) return hit;
      }
    }
    if (Array.isArray(payload.updates)) {
      for (const u of payload.updates) {
        if (!u) continue;
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            const hit = maybeUid(s);
            if (hit) return hit;
          }
        }
        if (Array.isArray(u.players)) {
          for (const p of u.players) {
            const hit = maybeUid(p);
            if (hit) return hit;
          }
        }
        if (u.action === "seat") {
          const hit = maybeUid(u);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

// Resolve "this hand's perspective owner" all the way to a stable
// display name. The casino-side `username` comes from the container's
// `userIndex` (built extension-side via `CasinoUsers.buildIndex` from
// REST / RSC blobs that carry both `id` and `username`). When that
// fails — which happens whenever the user only opens a table without
// hitting the lobby first — we fall back through:
//
//   1. `User <userId>`            if we found a userId for the seat
//   2. `Seat <seatId> @ <tableId>`  last-ditch bucket so anonymous
//                                   captures still get a player node
//                                   instead of being silently dropped
//
// We NEVER return null when `detectPerspective` succeeded — that was
// the v1 behaviour that made manual exports look like "rejected as
// generic". A round with visible hole cards is by definition
// non-generic; missing identity should not block ingest.
export function resolvePerspectivePlayer(envelope, userIndex) {
  const persp = detectPerspective(envelope);
  if (!persp) return null;
  const userId = resolveSeatUserId(envelope, persp.seatId);
  let name = null;
  if (userId != null && userIndex && Object.prototype.hasOwnProperty.call(userIndex, String(userId))) {
    const candidate = userIndex[String(userId)];
    if (typeof candidate === "string" && candidate.length > 0) name = candidate;
  }
  if (!name && userId != null) name = `User ${userId}`;
  if (!name) {
    const tid = envelope && envelope.tableId ? String(envelope.tableId) : "unknown";
    name = `Seat ${persp.seatId} @ ${tid}`;
  }
  return {
    seatId: persp.seatId,
    holeCards: persp.holeCards,
    casinoUserId: userId,
    name
  };
}
