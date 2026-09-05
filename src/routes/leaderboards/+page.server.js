// Ranks merged into the Data hub (2026-09-05). Old links keep working.
import { redirect } from "@sveltejs/kit";

export function load({ url }) {
  const p = new URLSearchParams(url.searchParams);
  p.set("view", "ranks");
  throw redirect(301, `/data?${p}`);
}
