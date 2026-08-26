// Merged into the unified /social section (S0). Kept as a redirect so old links
// and bookmarks still work (?to=<id> maps to opening that DM in Social).
import { redirect } from "@sveltejs/kit";

export function load({ url }) {
  const to = url.searchParams.get("to");
  throw redirect(308, to ? `/social?to=${encodeURIComponent(to)}` : "/social");
}
