// Login: hardcoded admin first, then ordinary `user` table.
//
// The admin's identity lives in code (`auth.js#HARDCODED_ADMIN_*`) and
// the DB only carries a shell row (id `admin-hardcoded`, password_hash
// NULL) so foreign keys resolve. We test the hardcoded constants
// before the DB lookup; on match we mint a session against the shell
// row's id. Ordinary users go through the normal scrypt-verify path
// against `password_hash`. The admin shell row's NULL hash makes the
// generic verify path always fail for that email, so wrong-admin
// password attempts never short-circuit through the DB branch.

import { fail, redirect } from "@sveltejs/kit";
import {
  findUserByEmail,
  verifyPassword,
  createSession,
  isHardcodedAdmin,
  HARDCODED_ADMIN_USER_ID
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

    // Hardcoded-admin path. Constant-time comparison inside.
    if (isHardcodedAdmin(email, password)) {
      const { token, expiresAt } = await createSession(HARDCODED_ADMIN_USER_ID);
      setSessionCookie(cookies, token, expiresAt);
      throw redirect(303, "/account");
    }

    // Ordinary path. The admin shell row's password_hash is NULL so
    // verifyPassword(...) returns false for any input — wrong-admin
    // attempts that fall through here will hit "Invalid email or
    // password" rather than leaking signal.
    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return fail(401, { email, error: "Invalid email or password." });
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(cookies, token, expiresAt);
    throw redirect(303, "/account");
  }
};
