// Autoflush ingest endpoint.
//
// The Chrome extension's `flush.js` posts gzipped JSON batches here.
// Currently the extension hard-codes a different URL
// (`statisticasino.example.com`), but if/when you decide to repoint it
// at this server, change `FLUSH_ENDPOINT` in
// `casinoMalwareExtension/serialize.js` to e.g. `http://localhost:5173/api/flush`.
//
// Payload shape (from serialize.js#buildFlushRequest):
//   {
//     v: 1,
//     format: "casino-flush",
//     batchId: "...",
//     batchTs: 1716000000000,
//     hands: [HandEnvelope, ...]
//   }
//
// Response: 200 with { summary } on success; 4xx with { error } on bad input.

import { json } from "@sveltejs/kit";
import { decodeContainer, ingestContainer } from "$lib/server/ingest.js";

export async function POST({ request, locals }) {
  const buf = Buffer.from(await request.arrayBuffer());
  const ce = request.headers.get("content-encoding");

  let container;
  try {
    container = await decodeContainer(buf, ce);
  } catch (e) {
    return json({ error: `decode failed: ${e.message || e}` }, { status: 400 });
  }
  if (!container || !Array.isArray(container.hands)) {
    return json({ error: "missing hands[] in body" }, { status: 400 });
  }

  // Autoflush is always anonymous from the server's perspective; the
  // extension doesn't (and shouldn't need to) send cookies. If you
  // later want per-user flushing, add an `Authorization: Bearer <token>`
  // check here and look up the user.
  const summary = await ingestContainer(container, locals.user ? locals.user.id : null);
  return json({ summary });
}
