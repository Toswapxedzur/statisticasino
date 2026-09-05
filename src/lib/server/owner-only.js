// Sections hidden from EVERYONE — the owner included (owner decision 2026-09-05):
// the casino.org data tooling (/data, /contribute) and the blog. Every route
// behind them answers 404 so they are indistinguishable from nonexistent
// pages. The code is kept intact; flip HIDDEN to false to bring them back.
import { error } from "@sveltejs/kit";

export const HIDDEN = true;

export function ownerOnly() {
  if (HIDDEN) throw error(404, "Not found");
}
