// POST /data/export-dump
//
// Body: { handKeys: string[] }
// Response: application/octet-stream — the same .casinodump format
//           the extension produces. Re-built on the server from
//           stored frames + canonical metadata.
//
// Anyone can call this endpoint — the data on /data is already
// public read; we just give visitors a convenient bulk download.
// The /upload (now /contribute) admin gate handles ingestion;
// download is symmetric.

import { error } from "@sveltejs/kit";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadHandsForExport } from "$lib/server/tables.js";

const SCHEMA_VERSION = 1;
const EXPORT_FORMAT = "casino-export";

export async function POST({ request }) {
  let body;
  try { body = await request.json(); }
  catch { throw error(400, "Body must be JSON"); }

  const handKeys = Array.isArray(body && body.handKeys)
    ? body.handKeys.map(String).filter(Boolean)
    : [];
  if (handKeys.length === 0) throw error(400, "handKeys[] required");

  const rows = await loadHandsForExport(handKeys);
  if (rows.length === 0) throw error(404, "No matching hands found");

  // Re-hydrate envelopes from stored bytes. We rebuild every field the
  // extension stamped; missing fields (pageUrl, pageTitle, handIndex)
  // weren't stored and aren't needed by the replay layer.
  const envelopes = rows.map((r) => {
    let frames = [];
    try { frames = JSON.parse(gunzipSync(r.framesBlob).toString("utf8")); }
    catch { frames = []; }
    return {
      v: SCHEMA_VERSION,
      handKey: r.handKey,
      handId: r.handId,
      tableId: r.tableId,
      tableNames: r.tableNames || null,
      pageUrl: null,
      pageTitle: null,
      handIndex: 0,
      firstTs: r.firstTs,
      lastTs: r.lastTs,
      actionCount: null,
      frameCount: frames.length,
      lifecycle: "finished",
      frames,
      contentHash: r.contentHash || null
    };
  });

  // Build a userIndex from the players we touched, mapping
  // casinoUserId -> name. Useful when re-importing into a fresh
  // database (the perspective resolver consults it).
  const userIndex = {};
  for (const r of rows) {
    if (r.player && r.player.casinoUserId != null && r.player.name) {
      userIndex[String(r.player.casinoUserId)] = r.player.name;
    }
  }

  const container = {
    v: SCHEMA_VERSION,
    format: EXPORT_FORMAT,
    exportedTs: Date.now(),
    handCount: envelopes.length,
    userIndex,
    hands: envelopes
  };

  const json = Buffer.from(JSON.stringify(container));
  const gz = gzipSync(json);
  const b64 = gz.toString("base64");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `casino-export-${stamp}.casinodump`;
  return new Response(b64, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Casino-Format": EXPORT_FORMAT,
      "X-Casino-Schema": String(SCHEMA_VERSION)
    }
  });
}
