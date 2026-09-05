// Turn consecutive public table views into sound cues. Pure: (prev, next, me)
// → [{ name, count?, gap?, delay?, volume? }]. The table page feeds it every
// TABLE_STATE for the table on screen, so sounds are scoped to what the
// player is looking at. Works on the poker view (street/board/lastAction);
// banked/bet games only get the round-result cues.
const ACTION_SOUND = [
  [/^fold$/i, "fold"],
  [/^check$/i, "check"],
  [/^call\b/i, "bet"],
  [/^bet\b/i, "bet"],
  [/^raise\b/i, "raise"],
  [/^all-?in$/i, "allin"]
];

function soundForLabel(label) {
  if (!label) return null;
  for (const [re, name] of ACTION_SOUND) if (re.test(label)) return name;
  return null;
}

export function tableSoundCues(prev, next, myUserId) {
  const cues = [];
  if (!next) return cues;
  if (!prev) return cues; // first snapshot: nothing happened yet

  const pSeats = prev.seats || [], nSeats = next.seats || [];
  const pById = new Map(pSeats.map((s) => [s.userId, s]));
  const nById = new Map(nSeats.map((s) => [s.userId, s]));

  // Players arriving / leaving (only real users, not empty seats).
  for (const s of nSeats) if (s.userId && !pById.has(s.userId)) cues.push({ name: "join" });
  for (const s of pSeats) if (s.userId && !nById.has(s.userId)) cues.push({ name: "leave" });

  // New hand: shuffle, then a card slide per dealt player.
  if (next.handNo != null && prev.handNo != null && next.handNo > prev.handNo) {
    const dealt = nSeats.filter((s) => s.hasCards || s.inHand).length || 2;
    cues.push({ name: "shuffle" });
    cues.push({ name: "deal", count: Math.min(dealt * 2, 12), gap: 85, delay: 500 });
    return cues; // the rest of the diff is noise across a hand boundary
  }

  // Betting actions: a seat's lastAction changed to a real action.
  const pBySeat = new Map(pSeats.map((s) => [s.seat, s]));
  for (const s of nSeats) {
    const before = pBySeat.get(s.seat)?.lastAction ?? null;
    if (s.lastAction && s.lastAction !== before) {
      const name = soundForLabel(s.lastAction);
      if (name) cues.push({ name, volume: s.userId === myUserId ? 1 : 0.85 });
    }
  }

  // Community cards: one card-place per new board card.
  const pb = (prev.board || []).length, nb = (next.board || []).length;
  if (nb > pb) cues.push({ name: "board", count: nb - pb, gap: 140, delay: 120 });

  // Street advanced (not the end of the hand): bets swept into the pot.
  if (prev.street && next.street && prev.street !== next.street && next.street !== "complete") {
    cues.push({ name: "pot" });
  }

  // Hand finished: showdown reveal (if any), chips to the winner, jingle if it's me.
  if (!prev.result && next.result) {
    const r = next.result;
    const revealed = Array.isArray(r.revealed) ? r.revealed.length : 0;
    if (r.type === "showdown" && revealed > 0) cues.push({ name: "showdown" });
    cues.push({ name: "winChips", delay: r.type === "showdown" ? 500 : 150 });
    const winners = r.winners || [];
    const mine = nSeats.find((s) => s.userId === myUserId);
    if (mine && winners.some((w) => w.seat === mine.seat)) cues.push({ name: "win", delay: 650 });
  }

  return cues;
}
