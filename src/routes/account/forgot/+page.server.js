// Forgot password — two-step, single route.
//
//   step "send":  email → (if a resettable account exists) a 6-digit code goes
//                 to that inbox via the same code machinery signup used
//                 (email_verification table: sha256 of the code, 10-min TTL,
//                 30 s resend cooldown, ≤6/hour). The response is IDENTICAL
//                 whether or not the address has an account, so the form can't
//                 be used to enumerate members.
//   step "reset": email + code + new password → verify (one-shot, consumes the
//                 code), scrypt-hash the new password, revoke every session of
//                 that user, then sign them in fresh.
//
// Not resettable (silently treated as "no account"): the hardcoded admin (its
// credential lives in code; the DB row has a NULL hash) and bot shells
// (`…@bot.riverside.invalid`, nobody reads that inbox).
import { fail, redirect } from "@sveltejs/kit";
import {
  findUserByEmail,
  createSession,
  resetPassword,
  HARDCODED_ADMIN_EMAIL
} from "$lib/server/auth.js";
import { issueAndSendCode, verifyCode } from "$lib/server/email-verification.js";
import { setSessionCookie } from "$lib/server/cookies.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_SUFFIX = "@bot.riverside.invalid";

async function resettableUser(email) {
  if (email === HARDCODED_ADMIN_EMAIL.toLowerCase()) return null;
  if (email.endsWith(BOT_SUFFIX)) return null;
  const u = await findUserByEmail(email);
  if (!u || !u.password_hash) return null;
  return u;
}

export async function load({ locals }) {
  if (locals.user) throw redirect(303, "/account");
  return {};
}

export const actions = {
  send: async ({ request }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return fail(400, { step: "send", email, error: "Enter a valid email address." });

    const u = await resettableUser(email);
    if (u) {
      const r = await issueAndSendCode(email, { purpose: "reset" });
      if (!r.ok && r.error === "throttled") {
        return fail(429, {
          step: "send", email,
          error: `A code was sent moments ago. Try again in ${Math.ceil((r.retryAfterMs || 0) / 1000)} s.`
        });
      }
      if (!r.ok && r.error === "rate_limit") {
        return fail(429, { step: "send", email, error: "Too many codes requested. Try again in an hour." });
      }
      if (!r.ok) {
        return fail(502, { step: "send", email, error: "Could not send the email right now. Try again shortly." });
      }
    }
    // Same answer for known and unknown addresses.
    return { step: "reset", email, sent: true };
  },

  reset: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const code = String(form.get("code") || "").trim();
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    const bad = (status, error) => fail(status, { step: "reset", email, sent: true, error });

    if (!EMAIL_RE.test(email)) return bad(400, "Enter a valid email address.");
    if (!/^\d{6}$/.test(code)) return bad(400, "The code is 6 digits.");
    if (password.length < 8) return bad(400, "Password must be at least 8 characters.");
    if (password !== confirm) return bad(400, "Passwords do not match.");

    const u = await resettableUser(email);
    // Verify only for real accounts, but keep the failure message uniform.
    const ok = u ? await verifyCode(email, code) : false;
    if (!ok || !u) return bad(400, "That code is wrong or has expired. Request a new one.");

    await resetPassword(u.id, password);
    const { token, expiresAt } = await createSession(u.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/account");
  }
};
