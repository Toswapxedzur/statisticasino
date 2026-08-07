// Analytical CSV exporter for `/data/export-csv`.
//
// Input: a list of "rich rows" returned by `loadHandsForExport(handKeys)`.
// Each row carries the canonical hand metadata + a gzipped frames blob.
// Output: three CSV strings:
//
//   * hands.csv    — one row per hand (high-level summary)
//   * actions.csv  — one row per (hand, authoritative action), in
//                    play order
//   * players.csv  — one row per (hand, seat) — the player's
//                    involvement in this hand
//
// Card visibility model (per spec, option B):
//   * hole_cards   carries whatever was visible in the captured frames
//                  (hero's two cards, plus any opponent who showed at
//                  showdown). Masked seats keep the casino's `XX`.
//   * board_cards  reflects only what was actually dealt. A preflop
//                  fold gives "" (zero community cards); a flop fold
//                  gives the three flop cards; the river of a showdown
//                  gives all five. Distinguish "not dealt" from
//                  "unknown" — the dataset is otherwise lossy.
//
// We deliberately do NOT include casino_username (per user spec) — the
// casino_user_id alone is sufficient for joining elsewhere and avoids
// inadvertently shipping casino-side handles to whoever opens the CSV.
//
// Pure module. No DB / network / DOM. Walks frames + emits strings.
// Caller (`+server.js`) handles gzip / zip.

import { gunzipSync } from "node:zlib";

// Authoritative gameplay actions. Mirrors casinoMalwareExtension/
// tableize.js#AUTHORITATIVE_ACTIONS and replay.js#STEP_ACTIONS, kept
// in sync by hand. Any change here means the action timeline diverges
// from what the in-page replay shows; bring them with you.
const STEP_ACTIONS = new Set([
  "startHand", "blinds", "dealHoleCards", "dealCommunityCards",
  "check", "call", "bet", "raise", "fold", "allIn",
  "updatePots", "betRefund", "showdown", "show", "muck",
  "awardPot", "finishHand"
]);

// Actions that voluntarily put money in the pot pre-showdown. Used for
// the players.csv `voluntarily_put_money_in_pot` column. `blinds` are
// excluded — posting the BB isn't a voluntary action by the standard
// poker-tracker definition.
const VOLUNTARY_ACTIONS = new Set(["bet", "call", "raise", "allIn"]);

// Map a community-board length to its betting round. 0 cards = the
// preflop round, 3 cards (flop dealt) = the flop round, etc. The
// "showdown" street isn't board-derivable — see streetForAction().
function streetFromBoardLen(n) {
  if (n >= 5) return "river";
  if (n >= 4) return "turn";
  if (n >= 3) return "flop";
  return "preflop";
}

const POSITION_LABELS_2 = ["BTN", "BB"];
const POSITION_LABELS_3 = ["BTN", "SB", "BB"];

// ---------------------------------------------------------- helpers

// Serialise a value for CSV. RFC 4180-ish: quote when needed, double
// any embedded quotes. `null`/`undefined` become "" so the column is
// present but empty.
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build one CSV string from a list of rows (each an array) and a
// header row. Always ends with `\n` so concatenation/streaming is
// well-defined.
export function toCsv(headers, rows) {
  const out = [];
  out.push(headers.map(csvCell).join(","));
  for (const r of rows) out.push(r.map(csvCell).join(","));
  return out.join("\n") + "\n";
}

// Parse a `casino_player` row's hole cards JSON. Tolerant: bad JSON
// returns null.
function parseHeroHoleCards(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length >= 2) return [String(arr[0]), String(arr[1])];
  } catch { /* fall through */ }
  return null;
}

// Re-hydrate a hand's frames from the stored gzip blob.
function decodeFrames(blob) {
  if (!blob || blob.length === 0) return [];
  try {
    const json = gunzipSync(blob).toString("utf8");
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Deduplicate-preserving join. Casino sometimes echoes the same
// community-card update twice across frames; we want to count each
// *distinct* card once, in dealing order.
function pushUnique(arr, item) {
  if (arr.indexOf(item) === -1) arr.push(item);
}

// Lowercase normalised card form. We keep what the casino sends but
// also need a consistent key for "is this card masked".
function isMaskedCard(c) {
  if (c == null) return true;
  const s = String(c);
  return s === "" || s === "X" || s === "x" || s === "?";
}

// Two-card concatenation, "AhKd" or "XX" for masked. Empty input
// returns "" (caller decides whether that means "not dealt" or "no
// data").
function joinCardPair(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  const a = isMaskedCard(cards[0]) ? "X" : String(cards[0]);
  const b = isMaskedCard(cards[1]) ? "X" : String(cards[1]);
  return `${a}${b}`;
}

// Compute position labels by walking seats clockwise from the dealer.
// Returns Map<seatId, label>. Active seats are the seats that
// `startHand.seats[]` listed (numeric seatIds, sorted ascending —
// casino seat numbers are 1-9 fixed positions on the felt, so a
// clockwise walk = sort by seatId ascending starting at the dealer).
function buildPositionMap(activeSeats, dealerSeatId) {
  const out = new Map();
  if (!Array.isArray(activeSeats) || activeSeats.length === 0) return out;
  const ordered = activeSeats.slice().sort((a, b) => a - b);
  const idx = ordered.indexOf(Number(dealerSeatId));
  if (idx < 0) {
    // Dealer not in the active list (shouldn't happen, but defend).
    for (const s of ordered) out.set(s, `seat-${s}`);
    return out;
  }
  // Rotate so position 0 is the BTN.
  const rotated = ordered.slice(idx).concat(ordered.slice(0, idx));
  const n = rotated.length;
  let labels;
  if (n === 2)      labels = POSITION_LABELS_2;
  else if (n === 3) labels = POSITION_LABELS_3;
  else {
    // 4+: BTN, SB, BB, UTG, UTG+1, ..., HJ, CO. We label the last seat
    // (clockwise neighbour of BTN going against the deal) as CO and
    // the second-to-last as HJ for n>=6; otherwise UTG+k fills the
    // middle seats. This matches the conventional online-poker
    // labelling.
    labels = ["BTN", "SB", "BB"];
    const middle = n - 3;     // seats between BB and CO
    if (middle === 1) {
      labels.push("CO");
    } else if (middle === 2) {
      labels.push("HJ", "CO");
    } else if (middle >= 3) {
      labels.push("UTG");
      for (let i = 1; i <= middle - 3; i++) labels.push(`UTG+${i}`);
      labels.push("HJ", "CO");
    }
  }
  for (let i = 0; i < n; i++) out.set(rotated[i], labels[i] || `seat-${rotated[i]}`);
  return out;
}

// ------------------------------------------------------ per-hand walk

// Walk a hand's frames and produce three pieces:
//   * `hand`           — one summary record (object)
//   * `actions`        — array of merged action records (one per step)
//   * `playersByHand`  — Map<seatId, perSeatRecord>
//
// `meta` carries the canonical-row fields we need for cross-cutting
// columns (handKey, table label, hero info, …).
function digestHand(meta, frames) {
  // Authoritative action timeline.
  const steps = [];
  // Community cards in dealing order (deduplicated).
  const board = [];
  // Per-seat state across the hand. Lazily filled on first sighting.
  const seats = new Map();   // seatId -> per-seat record
  // Snapshot of startHand seat list (for dealer + position computation).
  let dealerSeat = null;
  let startHandSeats = null;
  let startHandTs = null;
  let finishHandTs = null;
  // Once the casino emits a `showdown` action we shift the per-action
  // street column to "showdown". Pre-showdown it tracks the board.
  let showdownReached = false;

  function ensureSeat(seatId) {
    seatId = Number(seatId);
    if (!Number.isFinite(seatId)) return null;
    let rec = seats.get(seatId);
    if (!rec) {
      rec = {
        seatId,
        casinoUserId: null,
        startingStack: null,
        endingStack: null,
        holeCards: null,        // [c1, c2] or null
        voluntary: false,
        wonAmount: 0,
        // True iff this seat was occupied by a player in this hand.
        // Empty felt slots (the casino still reports them in
        // startHand.seats[]) get false → filtered out of players.csv
        // and excluded from position computation. We flip this on the
        // moment we see a userId at startHand or the seat takes any
        // action.
        active: false
      };
      seats.set(seatId, rec);
    }
    return rec;
  }

  // Mark the seat as a real player in this hand. Called for every
  // signal that proves the seat is occupied (userId at startHand,
  // any action, an awardPot recipient, finishHand stack, …).
  function markActive(seatId) {
    const rec = ensureSeat(seatId);
    if (rec) rec.active = true;
  }

  for (const f of frames) {
    if (!f || f.event !== "output") continue;
    const updates = f && f.payload && Array.isArray(f.payload.updates) ? f.payload.updates : null;
    if (!updates) continue;

    for (const u of updates) {
      if (!u || typeof u !== "object" || !u.action) continue;
      if (!STEP_ACTIONS.has(u.action)) continue;
      const action = u.action;
      const ts = f.ts || null;

      // Dispatch on action — most of the per-action effects live here.
      switch (action) {
        case "startHand": {
          startHandTs = ts;
          if (u.dealerSeat != null) dealerSeat = Number(u.dealerSeat);
          if (Array.isArray(u.seats)) {
            startHandSeats = [];
            for (const s of u.seats) {
              if (!s) continue;
              const sid = Number(s.id ?? s.seatId);
              if (!Number.isFinite(sid)) continue;
              const rec = ensureSeat(sid);
              if (!rec) continue;
              if (s.userId != null) rec.casinoUserId = Number(s.userId);
              if (s.stack != null) rec.startingStack = Number(s.stack);
              // Empty felt slots (no userId, no stack) stay
              // `active: false` and are filtered downstream.
              if (s.userId != null || s.stack != null) {
                rec.active = true;
                startHandSeats.push(sid);
              }
            }
          }
          break;
        }
        case "dealHoleCards": {
          // Capture every visible (non-masked) pair we see. Masked
          // pairs land as ["X","X"] so we know the seat received cards
          // but we can't see them. Receiving cards = active player.
          const players = Array.isArray(u.players) ? u.players : null;
          if (players) {
            for (const p of players) {
              if (!p || p.seatId == null || !Array.isArray(p.cards)) continue;
              const rec = ensureSeat(p.seatId);
              if (!rec) continue;
              rec.active = true;
              const cards = [
                isMaskedCard(p.cards[0]) ? "X" : String(p.cards[0]),
                isMaskedCard(p.cards[1]) ? "X" : String(p.cards[1])
              ];
              if (!rec.holeCards) {
                rec.holeCards = cards;
              } else {
                // Upgrade masked → real if a later frame revealed.
                if (rec.holeCards[0] === "X" && cards[0] !== "X") rec.holeCards[0] = cards[0];
                if (rec.holeCards[1] === "X" && cards[1] !== "X") rec.holeCards[1] = cards[1];
              }
            }
          }
          break;
        }
        case "dealCommunityCards": {
          if (Array.isArray(u.cards)) {
            for (const c of u.cards) {
              if (c != null && !isMaskedCard(c)) pushUnique(board, String(c));
            }
          }
          break;
        }
        case "show": {
          // Showdown reveal — overwrites the masked entry for that
          // seat.
          if (u.seatId != null && Array.isArray(u.cards) && u.cards.length >= 2) {
            const rec = ensureSeat(u.seatId);
            if (rec) {
              rec.active = true;
              rec.holeCards = [
                isMaskedCard(u.cards[0]) ? "X" : String(u.cards[0]),
                isMaskedCard(u.cards[1]) ? "X" : String(u.cards[1])
              ];
            }
          }
          break;
        }
        case "bet":
        case "call":
        case "raise":
        case "allIn":
        case "fold":
        case "check":
        case "muck":
        case "betRefund": {
          // Any seat-bound action proves the seat was occupied. We
          // also flag voluntary money-in for the players.csv column;
          // posting blinds does NOT count (handled in case "blinds").
          if (u.seatId != null) {
            markActive(u.seatId);
            const rec = seats.get(Number(u.seatId));
            if (rec && VOLUNTARY_ACTIONS.has(action)) rec.voluntary = true;
          }
          break;
        }
        case "blinds": {
          // Posting a blind isn't voluntary, but it does mark the
          // seat as active.
          if (u.smallBlind && u.smallBlind.seatId != null) markActive(u.smallBlind.seatId);
          if (u.bigBlind && u.bigBlind.seatId != null) markActive(u.bigBlind.seatId);
          if (Array.isArray(u.players)) {
            for (const p of u.players) {
              if (p && p.seatId != null) markActive(p.seatId);
            }
          }
          break;
        }
        case "awardPot": {
          if (Array.isArray(u.players)) {
            for (const p of u.players) {
              if (!p || p.seatId == null) continue;
              const rec = ensureSeat(p.seatId);
              if (!rec) continue;
              rec.active = true;
              const chips = Number(p.chips || 0);
              if (Number.isFinite(chips)) rec.wonAmount += chips;
            }
          }
          break;
        }
        case "finishHand": {
          finishHandTs = ts;
          if (Array.isArray(u.players)) {
            for (const p of u.players) {
              if (!p || p.seatId == null) continue;
              const rec = ensureSeat(p.seatId);
              if (!rec) continue;
              // finishHand reports stacks for all seats including
              // empty ones with stack 0; only flag active when the
              // seat had non-trivial signal earlier OR a non-zero
              // stack here.
              if (p.stack != null) {
                rec.endingStack = Number(p.stack);
                if (Number(p.stack) > 0) rec.active = true;
              }
            }
          }
          break;
        }
        case "showdown": {
          showdownReached = true;
          break;
        }
        default:
          // Other authoritative actions (blinds, check, fold, muck,
          // updatePots, betRefund) don't move per-seat or per-hand
          // summary fields — they only land on the action timeline.
          break;
      }

      // Append to the action timeline. We snapshot the state-evolving
      // fields *after* applying the dispatch above so the row's
      // `street` reflects the streets dealt up to and including this
      // action. After the casino emits its `showdown` marker every
      // subsequent row inherits "showdown" — that includes show /
      // muck / awardPot / finishHand which all happen at the table
      // post-showdown.
      const street = showdownReached
        ? "showdown"
        : streetFromBoardLen(board.length);
      // For dealCommunityCards rows we want the row to show the
      // newly-dealt cards, not the cumulative board.
      let cardsCol = "";
      if (action === "dealCommunityCards" && Array.isArray(u.cards)) {
        cardsCol = u.cards.map((c) => isMaskedCard(c) ? "X" : String(c)).join("");
      } else if (action === "show" && Array.isArray(u.cards)) {
        cardsCol = u.cards.slice(0, 2).map((c) => isMaskedCard(c) ? "X" : String(c)).join("");
      }
      steps.push({
        ts,
        action,
        street,
        seatId: u.seatId != null ? Number(u.seatId) : null,
        chips: u.chips != null ? Number(u.chips) : null,
        cards: cardsCol
      });
    }
  }

  // Position labels are computed over the seats that were actually
  // playing. Empty felt slots reported in startHand.seats[] (no
  // userId, no stack) would otherwise inflate the rotation and
  // mis-label every active player. Falls back to startHandSeats if
  // we have nothing else (e.g. corrupt frames).
  const activeSeatIds = Array.from(seats.values())
    .filter((s) => s.active)
    .map((s) => s.seatId);
  const positionMap = buildPositionMap(
    activeSeatIds.length > 0 ? activeSeatIds : (startHandSeats || []),
    dealerSeat
  );

  const handRow = {
    handKey: meta.handKey,
    handId: meta.handId,
    tableId: meta.tableId,
    tableName: (meta.tableNames && meta.tableNames[0]) || "",
    firstTs: meta.firstTs,
    lastTs: meta.lastTs,
    dealerSeat: dealerSeat,
    numSeats: activeSeatIds.length > 0
      ? activeSeatIds.length
      : (startHandSeats ? startHandSeats.length : seats.size),
    numActions: steps.length,
    heroSeat: meta.heroSeat,
    heroHoleCards: meta.heroHoleCards ? joinCardPair(meta.heroHoleCards) : "",
    boardCards: board.join(""),
    streetReached: showdownReached ? "showdown" : streetFromBoardLen(board.length),
    startHandTs,
    finishHandTs,
    playerName: meta.playerName,            // canonical-row player label
    playerCasinoUserId: meta.playerCasinoUserId
  };

  // Fold per-seat records into rows (one per (hand, seat)). Empty
  // felt slots are filtered out — they're not players.
  const playerRows = [];
  for (const rec of seats.values()) {
    if (!rec.active) continue;
    playerRows.push({
      handKey: meta.handKey,
      seatId: rec.seatId,
      casinoUserId: rec.casinoUserId,
      position: positionMap.get(rec.seatId) || "",
      startingStack: rec.startingStack,
      endingStack: rec.endingStack,
      holeCards: rec.holeCards
        ? `${rec.holeCards[0]}${rec.holeCards[1]}`
        : "XX",                  // seat present, never dealt? rare; default to masked
      voluntarilyPutMoneyInPot: rec.voluntary ? 1 : 0,
      wonAmount: rec.wonAmount || 0
    });
  }

  return { handRow, actionRows: steps, playerRows };
}

// ----------------------------------------------------- public surface

// Build the three CSVs from the rows returned by
// `loadHandsForExport(handKeys)`. Caller is responsible for zipping.
//
// Returns { hands, actions, players }, each a CSV string.
export function buildCsvBundle(rows) {
  const handsRows = [];
  const actionsRows = [];
  const playersRows = [];

  for (const r of rows) {
    const frames = decodeFrames(r.framesBlob);
    const meta = {
      handKey: r.handKey,
      handId: r.handId,
      tableId: r.tableId,
      tableNames: r.tableNames,
      firstTs: r.firstTs,
      lastTs: r.lastTs,
      heroSeat: r.heroSeat,
      heroHoleCards: r.heroHoleCards,
      playerName: r.player ? r.player.name : null,
      playerCasinoUserId: r.player ? r.player.casinoUserId : null
    };
    const { handRow, actionRows, playerRows } = digestHand(meta, frames);

    handsRows.push([
      handRow.handKey,
      handRow.handId,
      handRow.tableId,
      handRow.tableName,
      handRow.firstTs,
      handRow.lastTs,
      handRow.dealerSeat,
      handRow.numSeats,
      handRow.numActions,
      handRow.heroSeat,
      handRow.heroHoleCards,
      handRow.boardCards,
      handRow.streetReached,
      handRow.startHandTs,
      handRow.finishHandTs,
      handRow.playerName,
      handRow.playerCasinoUserId
    ]);

    let stepIdx = 1;
    for (const a of actionRows) {
      actionsRows.push([
        handRow.handKey,
        stepIdx++,
        a.ts,
        a.action,
        a.street,
        a.seatId,
        a.chips,
        a.cards
      ]);
    }

    for (const p of playerRows) {
      playersRows.push([
        p.handKey,
        p.seatId,
        p.casinoUserId,
        p.position,
        p.startingStack,
        p.endingStack,
        p.holeCards,
        p.voluntarilyPutMoneyInPot,
        p.wonAmount
      ]);
    }
  }

  return {
    hands: toCsv(
      [
        "hand_key", "hand_id", "table_id", "table_name",
        "first_ts", "last_ts",
        "dealer_seat", "num_seats", "num_actions",
        "hero_seat", "hero_hole_cards",
        "board_cards", "street_reached",
        "start_hand_ts", "finish_hand_ts",
        "player_name", "player_casino_user_id"
      ],
      handsRows
    ),
    actions: toCsv(
      [
        "hand_key", "step", "ts", "action", "street",
        "seat_id", "chips", "cards"
      ],
      actionsRows
    ),
    players: toCsv(
      [
        "hand_key", "seat_id", "casino_user_id", "position",
        "starting_stack", "ending_stack", "hole_cards",
        "voluntarily_put_money_in_pot", "won_amount"
      ],
      playersRows
    )
  };
}
