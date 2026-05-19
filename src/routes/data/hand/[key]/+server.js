// Returns one hand's full payload (frames + perspectives + uploads) as
// JSON. Called by the inline replay component on click.
//
// We gunzip on the server because the client never sees the raw blob
// and decoding gzip in the browser would require a ~10 KB polyfill or
// the (still-spotty) DecompressionStream API.

import { json, error } from "@sveltejs/kit";
import { gunzipSync } from "node:zlib";
import { loadHand } from "$lib/server/tables.js";

export async function GET({ params }) {
  const hand = await loadHand(params.key);
  if (!hand) throw error(404, "Hand not found");

  let frames = [];
  try {
    frames = JSON.parse(gunzipSync(hand.framesBlob).toString("utf8"));
  } catch (e) {
    throw error(500, `Could not decode frames: ${e.message || e}`);
  }

  return json({
    handKey: hand.handKey,
    tableId: hand.tableId,
    handId: hand.handId,
    firstTs: hand.firstTs,
    lastTs: hand.lastTs,
    tableNames: hand.tableNames,
    frames,
    perspectives: hand.perspectives,
    uploads: hand.uploads
  });
}
