import { fail, redirect } from "@sveltejs/kit";
import { createUser, findUserByEmail, createSession } from "$lib/server/auth.js";
import { setSessionCookie } from "$lib/server/cookies.js";

export async function load({ locals }) {
  if (locals.user) throw redirect(303, "/account");
  return {};
}

export const actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const displayName = String(form.get("displayName") || "").trim() || null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { email, displayName, error: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return fail(400, { email, displayName, error: "Password must be at least 8 characters." });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return fail(409, { email, displayName, error: "An account with that email already exists." });
    }

    const u = await createUser(email, password, displayName);
    const { token, expiresAt } = await createSession(u.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/account");
  }
};
