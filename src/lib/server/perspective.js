// Perspective-owner detection.
//
// The poker server only deals real hole cards to the seat owned by the
// connected user; every other seat shows ["X","X"] in `dealHoleCards`.
// So the seat with a fully-resolved card pair after `dealHoleCards` is
// the upload's perspective owner.
//
// Edge cases:
//   - mucked hand without `show` -> still detectable from dealHoleCards
//   - bulk-update playback (a `show` update reveals OTHER seats later)
//     -> we use the FIRST dealHoleCards update only, so "shown by the
//     opponent at showdown" doesn't count as a perspective claim.
//   - all seats masked (rare; a `dealHoleCards` that omits the local
//     seat for some reason) -> return null and the caller stores a
//     null perspective_seat_id.

const MASK = new Set(["X", "x", "?", ""]);

function isMaskedCard(c) {
  return c == null || MASK.has(String(c));
}

function isRealPair(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return false;
  return !isMaskedCard(cards[0]) && !isMaskedCard(cards[1]);
}

// Walk the envelope's frames, find the FIRST `dealHoleCards` update,
// and return { seatId, holeCards }. Returns null if no qualifying
// seat exists.
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

// Returns the union of all perspective hole cards for a hand. Used by
// the renderer when one canonical hand has been claimed by multiple
// uploaders. Input is an array of rows from `hand_perspective`.
export function unionHoleCards(perspectiveRows) {
  const out = {};
  for (const r of perspectiveRows) {
    if (r.seat_id == null) continue;
    let cards;
    try { cards = JSON.parse(r.hole_cards_json); } catch { cards = null; }
    if (Array.isArray(cards) && cards.length === 2) {
      out[r.seat_id] = cards;
    }
  }
  return out;
}
