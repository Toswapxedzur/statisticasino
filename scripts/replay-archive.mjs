#!/usr/bin/env node
// Replay tiering — the VPS side of the home archive (see DEPLOYMENT.md §Archive).
//
// Matches older than the archive window have their big `replay_json` moved to
// the home Mac mini (mini2); the small metadata + participant rows stay here so
// stats/history/access control never depend on home. Two-phase, driven by
// mini2 over SSH (it pulls; the VPS never reaches home):
//
//   export  — write eligible rows as gzipped per-replay files + a manifest
//             (sha256s) under an export dir; nothing in the DB changes.
//   mark    — stdin = the manifest entries mini2 verified byte-for-byte;
//             extract `final` → final_json, set archived_at/archive_ref,
//             NULL replay_json. Only rows still un-archived are touched.
//   prune-legacy — NULL the dead poker_hand.state_json blobs past the window.
//   cleanup — remove the export dir once mini2 has everything.
//
// Usage (run from /opt/riverside):
//   node scripts/replay-archive.mjs export --older-than-hours 168 --out var/archive-export/run1
//   node scripts/replay-archive.mjs mark < verified.json
//   node scripts/replay-archive.mjs prune-legacy --older-than-hours 168
//   node scripts/replay-archive.mjs cleanup --out var/archive-export/run1

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// .env next to the project root (same convention as server.js).
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { query, execute, closePool } = await import("../src/lib/server/db.js");

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const olderThanMs = Number(opt("older-than-hours", "168")) * 3_600_000;
const cutoff = Date.now() - olderThanMs;
const limit = Number(opt("limit", "5000"));
const outDir = opt("out", null);

function refFor(row) {
  const d = new Date(Number(row.ended_at));
  const yy = d.getUTCFullYear(), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), dd = String(d.getUTCDate()).padStart(2, "0");
  return `replays/${yy}/${mm}/${dd}/${row.id}.json.gz`;
}

async function cmdExport() {
  if (!outDir) throw new Error("--out required");
  const rows = await query(
    `SELECT id, ended_at, replay_json FROM match_replay
      WHERE archived_at IS NULL AND replay_json IS NOT NULL AND ended_at < ?
      ORDER BY ended_at ASC LIMIT ?`,
    [cutoff, limit]
  );
  const manifest = [];
  let bytes = 0;
  for (const r of rows) {
    const ref = refFor(r);
    const gz = gzipSync(Buffer.from(r.replay_json, "utf8"), { level: 9 });
    const path = join(outDir, ref);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, gz);
    const sha256 = createHash("sha256").update(gz).digest("hex");
    manifest.push({ id: r.id, ref, sha256, bytes: gz.length, ended_at: Number(r.ended_at) });
    bytes += gz.length;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));
  console.log(JSON.stringify({ exported: manifest.length, bytes, cutoff, outDir }));
}

async function cmdMark() {
  const verified = JSON.parse(readFileSync(0, "utf8"));
  let marked = 0, skipped = 0;
  const now = Date.now();
  for (const v of verified) {
    const row = (await query("SELECT replay_json FROM match_replay WHERE id = ? AND archived_at IS NULL", [v.id]))[0];
    if (!row || row.replay_json == null) { skipped += 1; continue; }
    // Re-derive the hash from the CURRENT row so we never null a row whose
    // content differs from what mini2 holds.
    const gz = gzipSync(Buffer.from(row.replay_json, "utf8"), { level: 9 });
    const sha = createHash("sha256").update(gz).digest("hex");
    if (sha !== v.sha256) { skipped += 1; continue; }
    let final = null;
    try { final = JSON.parse(row.replay_json).final ?? null; } catch { /* keep null */ }
    await execute(
      `UPDATE match_replay SET final_json = ?, archived_at = ?, archive_ref = ?, replay_json = NULL
        WHERE id = ? AND archived_at IS NULL`,
      [final == null ? null : JSON.stringify(final), now, v.ref, v.id]
    );
    marked += 1;
  }
  console.log(JSON.stringify({ marked, skipped }));
}

async function cmdPruneLegacy() {
  let total = 0;
  for (;;) {
    const r = await execute(
      "UPDATE poker_hand SET state_json = NULL WHERE state_json IS NOT NULL AND ended_at < ? LIMIT 2000",
      [cutoff]
    );
    const n = Number(r?.affectedRows ?? r?.[0]?.affectedRows ?? 0);
    total += n;
    if (n < 2000) break;
  }
  console.log(JSON.stringify({ prunedLegacyStateJson: total, cutoff }));
}

function cmdCleanup() {
  if (!outDir) throw new Error("--out required");
  const abs = resolve(outDir);
  if (!abs.includes("archive-export")) throw new Error("refusing to remove a non-export dir");
  rmSync(abs, { recursive: true, force: true });
  console.log(JSON.stringify({ removed: abs }));
}

try {
  if (cmd === "export") await cmdExport();
  else if (cmd === "mark") await cmdMark();
  else if (cmd === "prune-legacy") await cmdPruneLegacy();
  else if (cmd === "cleanup") cmdCleanup();
  else { console.error("usage: replay-archive.mjs export|mark|prune-legacy|cleanup"); process.exitCode = 2; }
} catch (err) {
  console.error("[replay-archive]", err?.message || err);
  process.exitCode = 1;
} finally {
  try { await closePool(); } catch { /* noop */ }
}
