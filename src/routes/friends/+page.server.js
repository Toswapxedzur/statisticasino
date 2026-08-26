// Merged into the unified /social section (S0). Kept as a redirect so old links
// and bookmarks still work.
import { redirect } from "@sveltejs/kit";

export function load() {
  throw redirect(308, "/social");
}
