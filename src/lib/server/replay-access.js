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

// HARD HORIZON (owner policy, 2026-09-05): the server keeps 7 days of history;
// everything older is OWNER-ONLY — not even the player themself can reach it.
// Older replay documents live on the home archive and are fetched only for
// the site owner (admin).
export const HOT_WINDOW_MS = 7 * 86_400_000;

// Public exposure can never exceed the hot window.
export const HISTORY_WINDOWS = ["private", "7d"];

// Earliest ended_at (ms) this user exposes publicly, or null when private.
// Legacy values (30d/90d/all) clamp to the 7-day horizon.
export function windowStartFor(historyWindow, now = Date.now()) {
  const w = historyWindow || "private";
  if (w === "private") return null;
  return now - HOT_WINDOW_MS;
}

// Earliest ended_at (ms) a signed-in viewer may see of ANY history — their own
// included. The owner sees everything; everyone else only the hot window.
export function historySinceFor(user, now = Date.now()) {
  return user?.isAdmin ? 0 : now - HOT_WINDOW_MS;
}

// The exposure window for a user id (null = private). Missing user = private.
export async function windowStartForUser(userId, now = Date.now()) {
  if (!userId) return null;
  const row = await queryOne("SELECT history_window FROM user WHERE id = ?", [userId]);
  return row ? windowStartFor(row.history_window, now) : null;
}

// How `viewer` ({id, isAdmin} | null) may see the replay:
//   'owner'       — the site owner; the only access past the 7-day horizon;
//   'participant' — they were dealt in (full per-seat view of their own cards);
//   'public'      — some participant exposes it (showdown-public view only);
//   null          — not viewable.
export async function replayAccess(replayRow, participants, viewer, now = Date.now()) {
  if (viewer?.isAdmin) return "owner";
  if (now - Number(replayRow.ended_at) > HOT_WINDOW_MS) return null; // past the horizon: owner only
  const viewerUserId = viewer?.id ?? null;
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
