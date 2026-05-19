// Cookie name + serialisation. Centralised so the login + logout +
// hooks paths all agree.

export const SESSION_COOKIE = "casino_session";

export function setSessionCookie(cookies, token, expiresAt) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,           // local-first / http://localhost dev
    path: "/",
    expires: new Date(expiresAt)
  });
}

export function clearSessionCookie(cookies) {
  cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: new Date(0)
  });
}
