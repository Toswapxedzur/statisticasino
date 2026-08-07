// Autoflush ingest endpoint.
//
// The Chrome extension's `flush.js` posts gzipped JSON batches here.
// The destination URL lives in `casinoMalwareExtension/serialize.js`
// (`FLUSH_ENDPOINT`), currently `https://www.sinostatistica.net/api/flush`.
// Repoint it at `http://localhost:5173/api/flush` for local testing.
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
import { verifyAdminFlushToken } from "$lib/server/auth.js";

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
  // Reject empty batches outright. Pre-fix, the extension's
  // flushNow batch loop could end up POSTing an empty payload when
  // the source frames had been evicted between refreshIndex() and
  // buildEnvelopesForRecords(); we'd return 200 with received:0
  // and the client would silently flag every queued record as
  // flushed. The client is fixed too (skips the POST when envs is
  // empty), but we keep the server-side guard as defence-in-depth.
  if (container.hands.length === 0) {
    return json({ error: "empty hands[]" }, { status: 400 });
  }

  // Admin auth for autoflush is via an embedded shared-secret token
  // (the extension's settings.adminToken; HARDCODED_ADMIN_FLUSH_TOKEN
  // server-side). The token is in the gzipped body, never in a header
  // or query string, so it doesn't surface in nginx / Cloudflare access
  // logs. The web-cookie path is also honoured for completeness — an
  // admin who's somehow attached cookies to their flush request still
  // gets isAdmin=true.
  const adminAuth = verifyAdminFlushToken(container.adminToken);
  const cookieAdmin = !!(locals.user && locals.user.isAdmin);
  const isAdmin = adminAuth === "accepted" || cookieAdmin;
  // Defensive scrub: don't carry the plaintext into ingest.js's
  // transaction context where it could end up in error breadcrumbs.
  if ("adminToken" in container) delete container.adminToken;

  const summary = await ingestContainer(
    container,
    locals.user ? locals.user.id : null,
    { isAdmin }
  );
  // Echo back enough for the extension to surface the auth state in
  // its console diagnostics — no plaintext, just the verdict.
  summary.adminAuth = adminAuth;
  return json({ summary });
}
