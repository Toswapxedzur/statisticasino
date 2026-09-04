// Access policy for recorded matches and play-history exposure.
//
// Every user has `history_window` (private | 7d | 30d | 90d | all): how much of
// their play history is visible to OTHER signed-in-or-not visitors on their
// profile. A user always sees their own history in full.
//
// A single replay is viewable by a non-participant only when at least one
// participant currently exposes a window that covers the match's ended_at —
// that is exactly the set of replays reachable from some public profile.
// Hole-card redaction on top of this is the viewer's business (replay route):
// even a participant only ever sees what they could see at the table.

import { query, queryOne } from "./db.js";

const WINDOW_MS = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000
};

export const HISTORY_WINDOWS = ["private", "7d", "30d", "90d", "all"];

// Earliest ended_at (ms) this user exposes publicly, or null when private.
export function windowStartFor(historyWindow, now = Date.now()) {
  const w = historyWindow || "private";
  if (w === "all") return 0;
  if (WINDOW_MS[w]) return now - WINDOW_MS[w];
  return null;
}

// The exposure window for a user id (null = private). Missing user = private.
export async function windowStartForUser(userId, now = Date.now()) {
  if (!userId) return null;
  const row = await queryOne("SELECT history_window FROM user WHERE id = ?", [userId]);
  return row ? windowStartFor(row.history_window, now) : null;
}

// How `viewerUserId` may see the replay:
//   'participant' — they were dealt in (full per-seat view of their own cards);
//   'public'      — some participant exposes it (showdown-public view only);
//   null          — not viewable.
export async function replayAccess(replayRow, participants, viewerUserId, now = Date.now()) {
  if (viewerUserId && participants.some((p) => p.user_id === viewerUserId)) return "participant";
  const ids = participants.map((p) => p.user_id).filter(Boolean);
  if (ids.length === 0) return null;
  const rows = await query(
    `SELECT id, history_window FROM user WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  for (const r of rows) {
    const start = windowStartFor(r.history_window, now);
    if (start != null && replayRow.ended_at >= start) return "public";
  }
  return null;
}
