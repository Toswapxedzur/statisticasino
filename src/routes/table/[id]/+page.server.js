// A single table page. Loads the table config for the initial render;
// live state (seats, hand, cards) streams over the WebSocket.

import { error } from "@sveltejs/kit";
import { getTable } from "$lib/server/poker/store.js";
import { getBalance } from "$lib/server/wallet.js";
import { hub } from "$lib/server/poker/hub.js";

export async function load({ params, locals }) {
  let t = await getTable(params.id);
  if (!t || !t.is_active) {
    // Ephemeral in-memory tables (tournaments) aren't in poker_table — fall back to
    // the live hub instance so the page renders (WS then streams the real state).
    const live = hub.tables?.get(params.id);
    if (live) {
      const c = live.config;
      t = { id: live.id, name: c.name, variant: c.variant, max_seats: c.maxSeats,
        small_blind: c.smallBlind, big_blind: c.bigBlind, min_buyin: c.minBuyin, max_buyin: c.maxBuyin, is_active: 1 };
    }
  }
  if (!t || !t.is_active) throw error(404, "Table not found");
  const walletChips = locals.user ? await getBalance(locals.user.id) : 0;
  return {
    walletChips,
    table: {
      id: t.id,
      name: t.name,
      variant: t.variant,
      maxSeats: t.max_seats,
      smallBlind: t.small_blind,
      bigBlind: t.big_blind,
      minBuyin: t.min_buyin,
      maxBuyin: t.max_buyin
    }
  };
}
