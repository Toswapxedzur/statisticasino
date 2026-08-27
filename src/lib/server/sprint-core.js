// River Sprint — pure economics & ranking. No DB, no engine: just the math that
// turns bids into a prize pool and final stacks into ranked payouts. Split out
// from sprint.js so it's exhaustively unit-testable.
//
// Economy: the prize pool is funded by HUMAN bids grossed up so the house overlay
// is exactly `faucet_bps` of the pool (default 30%) — pool = bids / (1 - faucet).
// Bots fill the field for a big, lively pool but are economically neutral: they
// neither bid nor collect, so the field can be "absurd" without minting chips
// beyond the fixed faucet. The high payout:bid ratio the design wants therefore
// scales with the HUMAN field — many real players ⇒ big pool ⇒ big top prize.

import { periodKey } from "./quests.js";

export const SPRINT = {
  BID: 200,                     // chip entry ("bid") — a sink
  STARTING_STACK: 1500,         // equal tournament chips each player starts with
  DURATION_MS: 15 * 60 * 1000,  // the 15-minute clock
  FAUCET_BPS: 3000,             // net faucet = 30% of the prize pool
  PAID_FRACTION: 0.15,          // top ~15% of the field cashes
  FINAL_TABLE: 9,               // "reached the final table" = top 9
  ROUNDS_PER_DAY: 2,            // timezone-split daily rounds
};

// UTC day bucket for the one-entry-per-day rule (reuses the quests daily key).
export function dayKey(at = Date.now()) { return periodKey("daily", at); }

// Gross prize pool from the human bids collected. pool = bids / (1 - faucet),
// so the overlay (pool - bids) is exactly faucet_bps of the pool.
export function prizePool(totalBids, faucetBps = SPRINT.FAUCET_BPS) {
  if (totalBids <= 0) return 0;
  const keep = 1 - faucetBps / 10000;
  if (keep <= 0) return totalBids;
  return Math.round(totalBids / keep);
}

// Net chips this pool injects into the economy (the faucet portion).
export function netFaucet(pool, totalBids) { return Math.max(0, pool - totalBids); }

// Top-heavy payout ladder: pay the top ~`paidFraction` of the field with a
// geometric decay so the champion takes the largest share. Returns prizes indexed
// by place (index 0 = 1st place). The rounding remainder goes to the champion so
// the payouts sum exactly to the pool.
export function payoutTable(pool, fieldSize, paidFraction = SPRINT.PAID_FRACTION) {
  if (pool <= 0 || fieldSize <= 0) return [];
  const paid = Math.max(1, Math.ceil(fieldSize * paidFraction));
  const decay = 0.72;
  const weights = Array.from({ length: paid }, (_, i) => Math.pow(decay, i));
  const sum = weights.reduce((a, b) => a + b, 0);
  const prizes = weights.map((w) => Math.floor((pool * w) / sum));
  const spent = prizes.reduce((a, b) => a + b, 0);
  prizes[0] += pool - spent;
  return prizes;
}

// Final standings from raw participants: [{ id, stack, bustAt }]. Higher stack
// ranks first; among equal stacks the player who lasted LONGER (greater bustAt)
// ranks higher; a stable id tiebreak keeps ordering deterministic. Returns the
// objects sorted, each annotated with a 1-based `place`.
export function rankStandings(participants) {
  const sorted = [...participants].sort((a, b) => {
    const sa = a.stack || 0, sb = b.stack || 0;
    if (sb !== sa) return sb - sa;
    const ba = a.bustAt || 0, bb = b.bustAt || 0;
    if (bb !== ba) return bb - ba;
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted.map((p, i) => ({ ...p, place: i + 1 }));
}

// The event-exclusive achievement keys a human's finishing place earns.
export function sprintBadges({ place, paidPlaces }) {
  const out = [];
  if (place && place <= paidPlaces) out.push("sprint_itm");
  if (place && place <= SPRINT.FINAL_TABLE) out.push("sprint_final");
  if (place === 1) out.push("sprint_champ");
  return out;
}
