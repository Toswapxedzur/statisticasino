// Shared, isomorphic site config (safe to import from both client and
// server — contains no secrets).
//
// The poker room's brand name lives here as a single constant so it can
// be renamed in ONE place. Change SITE_NAME and everything (topbar,
// <title>, landing copy, emails' From-name via env) follows.
export const SITE_NAME = "Riverside";
export const SITE_TAGLINE = "Poker with friends";
