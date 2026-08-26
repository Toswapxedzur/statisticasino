// Blocking + reporting. A block is directed but enforced in BOTH directions:
// blocked pairs can't DM or friend-request each other. Reports queue for admins.
import { randomBytes } from "node:crypto";
import { query, execute } from "./db.js";
import { removeFriend } from "./friends.js";

export async function block(blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return;
  await execute(
    "INSERT IGNORE INTO user_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    [blockerId, blockedId, Date.now()]
  );
  // Blocking also drops any friendship between them.
  await removeFriend(blockerId, blockedId);
}

export async function unblock(blockerId, blockedId) {
  await execute("DELETE FROM user_block WHERE blocker_id = ? AND blocked_id = ?", [blockerId, blockedId]);
}

// True if either user has blocked the other (enforcement is symmetric).
export async function isBlocked(a, b) {
  if (!a || !b) return false;
  const rows = await query(
    "SELECT 1 FROM user_block WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
    [a, b, b, a]
  );
  return rows.length > 0;
}

// Did `viewerId` block `otherId` (directed — for the profile's Block/Unblock state)?
export async function hasBlocked(viewerId, otherId) {
  if (!viewerId || !otherId) return false;
  const rows = await query(
    "SELECT 1 FROM user_block WHERE blocker_id = ? AND blocked_id = ? LIMIT 1",
    [viewerId, otherId]
  );
  return rows.length > 0;
}

export async function report(reporterId, targetId, reason) {
  if (!targetId) return;
  await execute(
    "INSERT INTO report (id, reporter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    [randomBytes(16).toString("hex"), reporterId || null, targetId, String(reason || "").slice(0, 500), Date.now()]
  );
}

// Admin queue: open reports, newest first, with reporter/target names.
export async function openReports(limit = 100) {
  return query(
    "SELECT r.id, r.reason, r.created_at, r.status, "
    + "  rp.display_name AS reporter_name, rp.email AS reporter_email, r.reporter_id, "
    + "  tg.display_name AS target_name, tg.email AS target_email, r.target_id "
    + "FROM report r "
    + "LEFT JOIN user rp ON rp.id = r.reporter_id "
    + "LEFT JOIN user tg ON tg.id = r.target_id "
    + "WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT ?",
    [limit]
  );
}

export async function resolveReport(reportId) {
  await execute("UPDATE report SET status = 'reviewed' WHERE id = ?", [reportId]);
}
