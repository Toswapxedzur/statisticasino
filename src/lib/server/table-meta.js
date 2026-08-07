// Per-table metadata helpers (server side).
//
// AUTHORITATIVE EXTRACTION HAPPENS IN THE EXTENSION (Option B,
// 2026-05-27). `casinoMalwareExtension/tableize.js#adoptStatePayload`
// reads `name` / `game` / `stakes` / `blinds` off the Phoenix `state`
// event at the bucket level and stamps them onto every envelope
// (`env.tableNames`, `env.gameVariant`, `env.stakesTier`,
// `env.smallBlind`, `env.bigBlind`). The server reads those fields
// straight from the envelope. We cannot re-extract state from the
// per-hand frame slice because `serialize.js#sliceHandFrames` clips
// it to `[startHand .. finishHand]` and the state event arrives
// BEFORE startHand.
//
// The helpers below are server-side fallbacks for envelopes whose
// in-band fields are missing — legacy uploads from pre-Option-B
// extensions, or rounds whose extension session didn't capture a
// `state` snapshot at all.
//
//   `extractStakeFromFrames(frames)` — find the first `blinds`
//      action inside payload.updates[] and return `{ smallBlind,
//      bigBlind }`. Used as the sb/bb fallback in ingest.js.
//      Returns null when no `blinds` shape is present.
//
//   `deriveStakesTierFromBlinds(bigBlind)` — last-resort tier
//      classification when `state.stakes` is unavailable.
//      Thresholds match what we've observed on replaypoker.com
//      (BB ≤ 10 → "low", ≤ 100 → "mid", else "high"). Returns null
//      on unusable input.
//
//   `extractTableStateFromFrames(frames)` — defensive helper: if a
//      frame slice DOES happen to include a `state` event (synthetic
//      test fixtures, or a future serialize.js that widens the
//      slice) it'll return the snapshot. Not wired into the live
//      ingest path because the production slice never contains
//      state events.
//
// LEGACY HELPERS (only called by migrateToV8 for the original
// v7→v8 backfill; not used by v9 ingest). Kept in place so a
// fresh-install boot that re-applies the v8 migration doesn't crash:
//
//   `parseBettingLimitFromNames(names)`
//   `isHoldemOnly(names)`

const NON_HOLDEM_VARIANTS = [
  "omaha", "stud", "razz", "draw", "badugi", "horse", "chinese",
  "pineapple"
];

// Order matters: long forms before short forms so the regex doesn't
// snag "NL" out of the middle of "Fixed/No-Limit Mixed" or similar.
const LIMIT_PATTERNS = [
  [/no[\s-]*limit|\bNL\b/i,    "No Limit"],
  [/pot[\s-]*limit|\bPL\b/i,   "Pot Limit"],
  [/fixed[\s-]*limit|\bFL\b/i, "Fixed Limit"],
  [/mixed[\s-]*limit|\bML\b/i, "Mixed Limit"]
];

// -------------------------------------------------- PRIMARY (v9)

export function extractTableStateFromFrames(frames) {
  if (!Array.isArray(frames)) return null;
  for (const f of frames) {
    if (!f || f.event !== "state") continue;
    const p = f.payload;
    if (!p || typeof p !== "object") continue;

    const name = typeof p.name === "string" && p.name.length > 0
      ? p.name
      : null;
    const stakesTier = typeof p.stakes === "string" && p.stakes.length > 0
      ? p.stakes.toLowerCase()
      : null;
    const gameVariant = typeof p.game === "string" && p.game.length > 0
      ? p.game.toLowerCase()
      : null;

    let smallBlind = null, bigBlind = null;
    if (p.blinds && typeof p.blinds === "object") {
      const sb = Number(p.blinds.small);
      const bb = Number(p.blinds.big);
      if (Number.isFinite(sb) && sb > 0) smallBlind = sb;
      if (Number.isFinite(bb) && bb > 0) bigBlind = bb;
    }

    return { name, stakesTier, gameVariant, smallBlind, bigBlind };
  }
  return null;
}

export function deriveStakesTierFromBlinds(bigBlind) {
  const bb = Number(bigBlind);
  if (!Number.isFinite(bb) || bb <= 0) return null;
  // Thresholds match the bucketing we've observed on replaypoker.com
  // (1/2, 2/4, 5/10 all reported as `state.stakes = "low"`). The
  // mid/high split is a best guess for casinos we haven't sampled.
  if (bb <= 10) return "low";
  if (bb <= 100) return "mid";
  return "high";
}

// -------------------------------------------------- FALLBACK

export function extractStakeFromFrames(frames) {
  if (!Array.isArray(frames)) return null;
  const blinds = findBlindsUpdate(frames);
  if (!blinds) return null;

  // Variant a: explicit smallBlind / bigBlind keys (some replay-engine
  // versions stamp them directly on the update).
  let sb = blinds.smallBlind && Number(blinds.smallBlind.chips);
  let bb = blinds.bigBlind && Number(blinds.bigBlind.chips);
  if (Number.isFinite(sb) && Number.isFinite(bb) && sb > 0 && bb > 0) {
    return { smallBlind: sb, bigBlind: bb };
  }

  // Variant b: read the two distinct postings out of players[].bet.
  // This is the shape Replay Poker actually sends — the only one
  // present in the live DB at the time of writing.
  if (Array.isArray(blinds.players)) {
    const posted = blinds.players
      .map((p) => Number(p && p.bet))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (posted.length >= 2 && posted[0] !== posted[1]) {
      return { smallBlind: posted[0], bigBlind: posted[1] };
    }
    if (posted.length >= 1) {
      // Heads-up / BB-only round: assume the lone posting is the BB
      // and the SB equals BB/2. (Cleaner than dropping the row.)
      const bbOnly = posted[posted.length - 1];
      return { smallBlind: bbOnly / 2, bigBlind: bbOnly };
    }
  }

  return null;
}

// -------------------------------------------------- LEGACY (v8 only)

export function parseBettingLimitFromNames(names) {
  if (!Array.isArray(names)) return null;
  for (const raw of names) {
    if (typeof raw !== "string" || !raw) continue;
    for (const [pat, label] of LIMIT_PATTERNS) {
      if (pat.test(raw)) return label;
    }
  }
  return null;
}

export function isHoldemOnly(names) {
  if (!Array.isArray(names) || names.length === 0) return true;
  const blob = names.join(" ").toLowerCase();
  for (const v of NON_HOLDEM_VARIANTS) {
    if (blob.includes(v)) return false;
  }
  return true;
}

// -------------------------------------------------- internals

function findBlindsUpdate(frames) {
  for (const f of frames) {
    const updates = f && f.payload && Array.isArray(f.payload.updates)
      ? f.payload.updates
      : null;
    if (!updates) continue;
    for (const u of updates) {
      if (u && u.action === "blinds") return u;
    }
  }
  return null;
}
