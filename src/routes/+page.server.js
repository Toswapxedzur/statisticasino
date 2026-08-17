// Lobby (home). Tables are ephemeral and WebSocket-driven, so SSR renders
// only the signed-in user + their wallet balance (for the New Table modal's
// buy-in caps). The live tables/players/leaderboard snapshot arrives over
// the socket — see +page.svelte.

import { getBalance } from "$lib/server/wallet.js";

export async function load({ locals }) {
  const walletChips = locals.user ? await getBalance(locals.user.id) : 0;
  return { user: locals.user, walletChips };
}
