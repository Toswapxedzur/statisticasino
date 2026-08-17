// Open signup — email + password (+ optional display name). No email
// verification code (the owner chose open signup for a private
// friends-room). New accounts receive the starting chip grant.
//
// The hardcoded admin email is still rejected here (the shell row owns
// that address). If you ever want to re-add email verification, the old
// two-step flow lived in git history / email-verification.js is retained.

import { fail, redirect } from "@sveltejs/kit";
import {
  createUser,
  findUserByEmail,
  createSession,
  HARDCODED_ADMIN_EMAIL
} from "$lib/server/auth.js";
import { setSessionCookie } from "$lib/server/cookies.js";
import { ensureStartingGrant } from "$lib/server/wallet.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAY_NAME_LEN = 64;

export async function load({ locals }) {
  if (locals.user) throw redirect(303, "/");
  return {};
}

export const actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const displayName = String(form.get("displayName") || "").trim() || null;

    const baseFail = (status, error) => fail(status, { email, displayName, error });

    if (!EMAIL_RE.test(email)) return baseFail(400, "Enter a valid email address.");
    if (password.length < 8) return baseFail(400, "Password must be at least 8 characters.");
    if (displayName && displayName.length > MAX_DISPLAY_NAME_LEN) {
      return baseFail(400, `Display name must be under ${MAX_DISPLAY_NAME_LEN} characters.`);
    }

    if (email === HARDCODED_ADMIN_EMAIL.toLowerCase()) {
      return baseFail(409, "An account with that email already exists.");
    }
    if (await findUserByEmail(email)) {
      return baseFail(409, "An account with that email already exists.");
    }

    const u = await createUser(email, password, displayName);
    await ensureStartingGrant(u.id);
    const { token, expiresAt } = await createSession(u.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/");
  }
};
