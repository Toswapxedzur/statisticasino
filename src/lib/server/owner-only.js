// Sections hidden from EVERYONE — the owner included (owner decision 2026-09-05):
// the casino.org data tooling (/casino-data, /contribute) and the blog. (/data
// itself is now Bluffing Valley's own data hub and is NOT hidden.) Every route
// behind them answers 404 so they are indistinguishable from nonexistent
// pages. The code is kept intact; flip HIDDEN to false to bring them back.
import { error } from "@sveltejs/kit";

export const HIDDEN = true;

export function ownerOnly() {
  if (HIDDEN) throw error(404, "Not found");
}
