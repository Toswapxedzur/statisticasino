// Two-step signup with email-code verification.
//
// `?/sendCode` (called from the "Send code" button):
//   * validates the email shape;
//   * refuses to send to an address that already owns an account
//     (either an ordinary user or the hardcoded admin shell row);
//   * issues a fresh code via email-verification.js, which also emails
//     the plaintext to the address.
//
// `?/create` (the form's main submit):
//   * re-validates email + password + display name;
//   * verifies the typed code against the most-recent unconsumed row;
//   * creates the `user` row + a session cookie on success.
//
// Both are *named* actions: SvelteKit refuses to mix a default action
// with named ones on the same page, so `default:` is gone and the form
// element has `action="?/create"` to wire its main submit. We never
// trust state across the two steps beyond what the DB remembers —
// `findUserByEmail` and `verifyCode` are both server-side, so the
// fact that the form is posted twice doesn't open a re-binding hole.

import { fail, redirect } from "@sveltejs/kit";
import {
  createUser,
  findUserByEmail,
  createSession,
  HARDCODED_ADMIN_EMAIL
} from "$lib/server/auth.js";
import { setSessionCookie } from "$lib/server/cookies.js";
import { issueAndSendCode, verifyCode } from "$lib/server/email-verification.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function load({ locals }) {
  if (locals.user) throw redirect(303, "/account");
  return {};
}

export const actions = {
  // ------------------------------------------------------ ?/sendCode
  // POSTed from the "Send code" button. We deliberately keep this
  // separate from the default action so the rest of the form fields
  // can stay empty/invalid at this point — the user only needs to
  // have typed an email.
  sendCode: async ({ request }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const displayName = String(form.get("displayName") || "").trim() || null;

    if (!EMAIL_RE.test(email)) {
      return fail(400, {
        step: "sendCode",
        email,
        displayName,
        error: "Enter a valid email address before requesting a code."
      });
    }

    // Block signup-shaped flow on the admin email — the admin shell
    // row already owns it. (A defence-in-depth check; the actual
    // create step also refuses.)
    if (email === HARDCODED_ADMIN_EMAIL.toLowerCase()) {
      return fail(409, {
        step: "sendCode",
        email,
        displayName,
        error: "An account with that email already exists."
      });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return fail(409, {
        step: "sendCode",
        email,
        displayName,
        error: "An account with that email already exists."
      });
    }

    const result = await issueAndSendCode(email);
    if (!result.ok) {
      if (result.error === "throttled") {
        const seconds = Math.ceil((result.retryAfterMs || 0) / 1000);
        return fail(429, {
          step: "sendCode",
          email,
          displayName,
          error: `Please wait ${seconds}s before requesting another code.`
        });
      }
      if (result.error === "rate_limit") {
        return fail(429, {
          step: "sendCode",
          email,
          displayName,
          error: "Too many codes requested. Try again later."
        });
      }
      return fail(502, {
        step: "sendCode",
        email,
        displayName,
        error: "Could not send the email. Please try again."
      });
    }

    // Surface the provider so the dev/staging console-log mode is
    // visible in the UI: "Code sent (stub)" hints at "check journalctl"
    // rather than "check your inbox".
    const stubbed = result.provider === "stub";
    return {
      step: "sendCode",
      email,
      displayName,
      codeSent: true,
      stubbed,
      message: stubbed
        ? "Code generated. Ask the operator to check the server logs (no live mailer configured)."
        : "Code sent. Check your inbox (and spam folder)."
    };
  },

  // ---------------------------------------------------------- create
  create: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const displayName = String(form.get("displayName") || "").trim() || null;
    const code = String(form.get("verificationCode") || "").trim();

    const baseFail = (status, error) =>
      fail(status, { step: "create", email, displayName, error });

    if (!EMAIL_RE.test(email)) return baseFail(400, "Enter a valid email address.");
    if (password.length < 8) return baseFail(400, "Password must be at least 8 characters.");
    if (!/^\d{6}$/.test(code)) return baseFail(400, "Enter the 6-digit verification code we emailed you.");

    if (email === HARDCODED_ADMIN_EMAIL.toLowerCase()) {
      return baseFail(409, "An account with that email already exists.");
    }
    const existing = await findUserByEmail(email);
    if (existing) {
      return baseFail(409, "An account with that email already exists.");
    }

    const codeOk = await verifyCode(email, code);
    if (!codeOk) {
      return baseFail(400, "That code is wrong or has expired. Please send a fresh one.");
    }

    const u = await createUser(email, password, displayName);
    const { token, expiresAt } = await createSession(u.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/account");
  }
};
