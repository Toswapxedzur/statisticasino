// A single table page. Loads the table config for the initial render;
// live state (seats, hand, cards) streams over the WebSocket.

import { error } from "@sveltejs/kit";
import { getTable } from "$lib/server/poker/store.js";
import { getBalance } from "$lib/server/wallet.js";

export async function load({ params, locals }) {
  const t = await getTable(params.id);
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
