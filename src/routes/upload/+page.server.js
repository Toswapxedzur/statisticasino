// Compatibility redirect — /upload was renamed to /contribute on
// 2026-05-21. Old links and bookmarks land here and bounce. We
// preserve any query string so a deep-link (rare) doesn't drop
// state.

import { redirect } from "@sveltejs/kit";

export function load({ url }) {
  const target = "/contribute" + (url.search || "");
  redirect(308, target);
}
