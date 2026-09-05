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
  if (next.game && next.game !== "poker") return gameCues(prev, next, myUserId);

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

// ---------------------------------------------------------------------------
// Banked / bet / draw / shedding games. Their `round` views differ per game, so
// the cues key off shapes rather than fields: every card-like string anywhere
// in the round is a dealt card, every bet entry is a chip placed, an
// `outcome` appearing is the resolve (dice / wheel / reels / cards), and
// `results` appearing settles the round for the viewer's seat.
const CARD_RE = /^([2-9TJQKA][shdc]|X|\?)$/;
const SKIP_KEYS = new Set(["results", "paytable", "betOptions", "bets", "outcome", "pile", "pileCards", "top"]);
const HIDDEN_RE = /^(X|\?)$/;

function countCards(v, depth = 0) {
  if (v == null || depth > 6) return 0;
  if (typeof v === "string") return CARD_RE.test(v) ? 1 : 0;
  if (Array.isArray(v)) { let n = 0; for (const x of v) n += countCards(x, depth + 1); return n; }
  if (typeof v === "object") { let n = 0; for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k)) n += countCards(v[k], depth + 1); return n; }
  return 0;
}
function countHidden(v, depth = 0) {
  if (v == null || depth > 6) return 0;
  if (typeof v === "string") return HIDDEN_RE.test(v) ? 1 : 0;
  if (Array.isArray(v)) { let n = 0; for (const x of v) n += countHidden(x, depth + 1); return n; }
  if (typeof v === "object") { let n = 0; for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k)) n += countHidden(v[k], depth + 1); return n; }
  return 0;
}
function countBets(round) {
  let n = 0;
  for (const p of round?.bets || []) n += (p.bets || []).length;
  return n;
}
const DICE_GAMES = new Set(["sic-bo", "craps"]);
const WHEEL_GAMES = new Set(["roulette", "money-wheel"]);

function netOf(r) {
  if (!r) return 0;
  if (typeof r.delta === "number") return r.delta;
  if (typeof r.net === "number") return r.net;
  return r.outcome === "win" ? 1 : r.outcome === "lose" ? -1 : 0;
}

function gameCues(prev, next, myUserId) {
  const cues = [];
  const pSeats = prev.seats || [], nSeats = next.seats || [];
  const pIds = new Set(pSeats.map((s) => s.userId).filter(Boolean));
  const nIds = new Set(nSeats.map((s) => s.userId).filter(Boolean));
  for (const id of nIds) if (!pIds.has(id)) cues.push({ name: "join" });
  for (const id of pIds) if (!nIds.has(id)) cues.push({ name: "leave" });

  const pr = prev.round || {}, nr = next.round || {};
  const newRound = next.handNo != null && prev.handNo != null && next.handNo > prev.handNo;
  const cardsBefore = newRound ? 0 : countCards(pr), cardsAfter = countCards(nr);
  const isCardGame = cardsAfter > 0 || countCards(pr) > 0 || nr.hands || nr.dealer;

  if (newRound && isCardGame) cues.push({ name: "shuffle" });
  if (cardsAfter > cardsBefore) {
    cues.push({ name: "deal", count: Math.min(cardsAfter - cardsBefore, 10), gap: 85, delay: newRound ? 450 : 0 });
  } else {
    // Same number of cards but fewer hidden ones: a face-down card was turned over.
    const h0 = newRound ? 0 : countHidden(pr), h1 = countHidden(nr);
    if (h1 < h0) cues.push({ name: "board", count: Math.min(h0 - h1, 5), gap: 140 });
  }

  // Chips placed (bet-selection games: roulette, sic bo, baccarat, slots, …).
  const b0 = newRound ? 0 : countBets(pr), b1 = countBets(nr);
  if (b1 > b0) {
    const mine = nSeats.find((s) => s.userId === myUserId);
    const mineBets = (nr.bets || []).find((p) => p.seat === mine?.seat)?.bets?.length ?? 0;
    const mineBefore = (pr.bets || []).find((p) => p.seat === mine?.seat)?.bets?.length ?? 0;
    cues.push({ name: "bet", volume: mineBets > mineBefore ? 1 : 0.7 });
  }

  // The resolve: wheel spin / dice roll / slot reels. Card resolves already
  // counted as dealt cards above.
  if (!pr.outcome && nr.outcome) {
    if (WHEEL_GAMES.has(next.game)) { cues.push({ name: "shake" }); cues.push({ name: "dice", delay: 550 }); }
    else if (DICE_GAMES.has(next.game)) { cues.push({ name: "shake" }); cues.push({ name: "dice", delay: 400 }); }
    else if (next.game === "slots") cues.push({ name: "reel", count: 3, gap: 220 });
  }

  // Keno: each drawn number.
  const d0 = newRound ? 0 : (pr.drawn || []).length, d1 = (nr.drawn || []).length;
  if (d1 > d0) cues.push({ name: "board", count: Math.min(d1 - d0, 10), gap: 110 });

  // Shedding games: a draw shows up as a bigger hand count for some player.
  if (!newRound && Array.isArray(nr.players) && Array.isArray(pr.players)) {
    let drawn = 0;
    for (const np of nr.players) { const pp = pr.players.find((x) => x.seat === np.seat); if (pp && typeof np.count === "number" && np.count > (pp.count ?? 0)) drawn += np.count - pp.count; }
    if (drawn > 0) cues.push({ name: "deal", count: Math.min(drawn, 8), gap: 85 });
  }
  // Shedding games: a card played onto the pile.
  const pile0 = newRound ? 0 : (pr.pile?.length ?? (pr.pileCards?.length ?? 0)), pile1 = nr.pile?.length ?? (nr.pileCards?.length ?? 0);
  if (pile1 > pile0) cues.push({ name: "board", count: Math.min(pile1 - pile0, 5), gap: 120 });

  // Settlement for the viewer's seat.
  const r0 = (newRound ? [] : (pr.results || [])), r1 = nr.results || [];
  if (r1.length > 0 && r0.length === 0) {
    const mine = nSeats.find((s) => s.userId === myUserId);
    const my = mine ? r1.find((r) => r.seat === mine.seat) : null;
    const delay = nr.outcome ? 700 : 150;
    if (my) {
      const net = netOf(my);
      if (net > 0) { cues.push({ name: "winChips", delay }); cues.push({ name: "win", delay: delay + 150 }); }
      else if (net < 0) cues.push({ name: "lose", delay });
      else cues.push({ name: "check", delay });
    } else {
      cues.push({ name: "pot", delay });
    }
  }
  return cues;
}
