import { fail, redirect } from "@sveltejs/kit";
import {
  findUserByEmail, verifyPassword,
  createSession, applyBootstrapPromotion
} from "$lib/server/auth.js";
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
    if (!email || !password) return fail(400, { email, error: "Email and password are required." });

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      // Constant-ish: don't reveal which half failed.
      return fail(401, { email, error: "Invalid email or password." });
    }

    // If the user matches ADMIN_EMAIL but their account predates the
    // env var, promote on login.
    await applyBootstrapPromotion(email);

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/account");
  }
};
