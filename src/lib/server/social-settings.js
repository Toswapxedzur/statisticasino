// Per-user social preferences, stored as JSON in `user.settings`.
//
// Single source of truth for the defaults + parsing, shared by the /settings
// page (load + save) and the WS hub (which gates typing indicators and read
// receipts on these toggles). Unknown/absent keys fall back to the defaults, so
// existing rows with NULL settings behave as "everything on".

import { queryOne } from "./db.js";

export const SOCIAL_DEFAULTS = Object.freeze({
  readReceipts: true,
  typing: true,
  allowGroupAdd: true,
  notifyFriendReq: true,
  notifyMessages: true,
  notifyTransfers: true,
});

export function parseSocialSettings(raw) {
  if (!raw) return { ...SOCIAL_DEFAULTS };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const out = { ...SOCIAL_DEFAULTS };
    for (const k of Object.keys(SOCIAL_DEFAULTS)) {
      if (typeof parsed?.[k] === "boolean") out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...SOCIAL_DEFAULTS };
  }
}

export function serializeSocialSettings(obj) {
  const out = {};
  for (const k of Object.keys(SOCIAL_DEFAULTS)) out[k] = !!obj?.[k];
  return JSON.stringify(out);
}

// Read a user's parsed social settings straight from the DB (no cache — the hub
// wraps this in its own short-lived cache to keep typing events cheap).
export async function getSocialSettings(userId) {
  if (!userId) return { ...SOCIAL_DEFAULTS };
  const row = await queryOne("SELECT settings FROM user WHERE id = ?", [userId]);
  return parseSocialSettings(row?.settings);
}
