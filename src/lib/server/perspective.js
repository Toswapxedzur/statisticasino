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
// Edge cases:
//   - mucked hand without `show` -> still detectable from dealHoleCards
//   - bulk-update playback (a `show` update reveals OTHER seats later)
//     -> we use the FIRST dealHoleCards update only, so "shown by the
//     opponent at showdown" doesn't count as a perspective claim.
//   - all seats masked (rare; a `dealHoleCards` that omits the local
//     seat) -> return null and the caller REJECTS the upload as
//     generic (no perspective).

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
export function detectPerspective(envelope) {
  if (!envelope || !Array.isArray(envelope.frames)) return null;
  for (const f of envelope.frames) {
    if (!f || f.event !== "output") continue;
    const updates = f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
    if (!updates) continue;
    for (const u of updates) {
      if (!u || u.action !== "dealHoleCards") continue;
      // Two known payload shapes in DATA_FORMAT.md:
      //   { action:"dealHoleCards", seats: [ {seatId, cards}, ... ] }
      //   { action:"dealHoleCards", seatId, cards }                  (rare)
      if (Array.isArray(u.seats)) {
        for (const s of u.seats) {
          if (!s) continue;
          if (isRealPair(s.cards)) {
            return { seatId: Number(s.seatId), holeCards: s.cards.slice(0, 2) };
          }
        }
      } else if (u.seatId != null && isRealPair(u.cards)) {
        return { seatId: Number(u.seatId), holeCards: u.cards.slice(0, 2) };
      }
      // Only the FIRST dealHoleCards counts — see header comment.
      return null;
    }
  }
  return null;
}

// Walk the envelope's frames looking for a seat-snapshot that maps
// `seatId -> userId`. Frames carry `seats: [{ id|seatId, userId, ... }]`
// in startHand / dealCommunityCards / state / output updates.
//
// Returns the first non-null userId we see for `targetSeatId`, or null
// if the envelope never names the seat's user.
export function resolveSeatUserId(envelope, targetSeatId) {
  if (!envelope || targetSeatId == null) return null;
  const frames = Array.isArray(envelope.frames) ? envelope.frames : [];
  const target = Number(targetSeatId);

  function scanSeat(s) {
    if (!s || typeof s !== "object") return null;
    const sid = s.seatId ?? s.id;
    if (sid == null || Number(sid) !== target) return null;
    const uid = s.userId ?? s.user_id;
    if (uid == null) return null;
    const n = Number(uid);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  for (const f of frames) {
    const payload = f && f.payload;
    if (!payload || typeof payload !== "object") continue;

    // Direct `seats: [...]` on the payload.
    if (Array.isArray(payload.seats)) {
      for (const s of payload.seats) {
        const hit = scanSeat(s);
        if (hit) return hit;
      }
    }
    // `updates: [{ ..., seats: [...] }]`.
    if (Array.isArray(payload.updates)) {
      for (const u of payload.updates) {
        if (!u) continue;
        if (Array.isArray(u.seats)) {
          for (const s of u.seats) {
            const hit = scanSeat(s);
            if (hit) return hit;
          }
        }
        // Some `seat` action shapes carry a single seat snapshot inline.
        if (u.action === "seat") {
          const hit = scanSeat(u);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

// Resolve "this hand's perspective owner" all the way to a casino-side
// display name. Falls back to `User <id>` when we know the userId but
// no name was available in the container's userIndex; returns null if
// neither a userId nor a name can be derived (caller should reject as
// generic).
//
// `userIndex` is `{ [userId]: username }` carried by the container
// (FlushRequest / ExportContainer). It is built extension-side from
// `CasinoUsers.buildIndex(messages)`.
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
  if (!name) return null;
  return {
    seatId: persp.seatId,
    holeCards: persp.holeCards,
    casinoUserId: userId,
    name
  };
}
