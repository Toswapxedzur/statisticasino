// Per-request server hooks.
//
// Responsibilities:
//   1. On boot (first request), ensure the schema is migrated. Idempotent.
//   2. Hydrate `event.locals.user` from the session cookie so any page
//      / endpoint can do `event.locals.user && ...` without re-parsing.
//   3. If the cookie's session was sliding-refreshed by validateSessionToken,
//      reissue the cookie with the new expiry.

import { ensureMigrated } from "$lib/server/migrate.js";
import { validateSessionToken } from "$lib/server/auth.js";
import { SESSION_COOKIE, setSessionCookie } from "$lib/server/cookies.js";

let _booted = false;

export async function handle({ event, resolve }) {
  if (!_booted) {
    await ensureMigrated();
    _booted = true;
  }

  const token = event.cookies.get(SESSION_COOKIE) || null;
  const { session, user } = await validateSessionToken(token);
  event.locals.user = user;     // null when anonymous
  event.locals.session = session;

  // If the session was refreshed, push the new expiry into the cookie so
  // the browser keeps it past the previous TTL.
  if (session && token) {
    setSessionCookie(event.cookies, token, session.expiresAt);
  }

  return resolve(event);
}
