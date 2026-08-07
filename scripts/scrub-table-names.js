// One-off scrub for casino_table.names_json (2026-05-28).
//
// Background:
//   Last week we manually seeded names_json for legacy rows whose names
//   were never captured. The seed strings were of the form
//     "Low Stakes - Table - 5/10 - NL Holdem"
//   so the /data tree would render *something* for those rows. That
//   worked until tableTitle() was unified to always compose the full
//   label from the structured columns — at which point the seeded
//   strings produce double-prefixed labels like
//     "Low Stakes - Low Stakes - Table - 5/10 - NL Holdem - 5/10 - NL Holdem"
//
//   This script reverses the manual seed: it inspects every
//   casino_table.names_json entry, drops entries that match the
//   synthetic shape, and rewrites names_json to NULL if no real names
//   remain (so tableTitle's "Table" fallback kicks in).
//
// Idempotent and safe to re-run. Prints a one-line dry-run summary by
// default; pass `--apply` to write the changes.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");

const { query, execute, closePool } = await import("../src/lib/server/db.js");

// Synthetic-seed shape, anchored on the whole-string match. Two
// historical forms we need to handle:
//
//   1. "Low Stakes - Table - 5/10 - NL Holdem"
//      — no lobby name was ever observed; the seed used the literal
//        word "Table" in the middle slot.
//   2. "Low Stakes - Duck Pond 7 - 1/2 - NL Holdem"
//      — a real lobby name existed and got *wrapped* in the synthetic
//        prefix/suffix at seed time.
//
// Pattern: anchored tier prefix + sb/bb + variant suffix; the middle
// slot captures non-greedily into group 1.
//
// If group 1 is the literal "Table" we drop the entry (no real name).
// Otherwise we keep just the captured name so the renderer can compose
// the rest from structured columns.
//
// Anchoring on a numeric "sb/bb - NL Holdem" tail prevents this from
// matching real lobby names that happen to start with "Low Stakes" —
// real names don't include the blinds at the end.
const SEED_RE =
  /^(?:Low|Mid|High) Stakes - (.+?) - \d+\/\d+ - (?:NL|PL|FL|ML) Holdem$/;

function scrubName(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  const m = SEED_RE.exec(s);
  if (!m) return s; // not synthetic; keep as-is
  const inner = m[1];
  return inner === "Table" ? null : inner;
}

function scrubNames(arr) {
  if (!Array.isArray(arr)) return null;
  const kept = [];
  for (const raw of arr) {
    const cleaned = scrubName(raw);
    if (cleaned != null && kept.indexOf(cleaned) === -1) kept.push(cleaned);
  }
  return kept.length ? kept : null;
}

const rows = await query(
  "SELECT id, names_json FROM casino_table WHERE names_json IS NOT NULL"
);

let inspected = 0, willClear = 0, willTrim = 0, untouched = 0;
const changes = [];

for (const row of rows) {
  inspected++;
  let parsed;
  try { parsed = JSON.parse(row.names_json); }
  catch { untouched++; continue; }
  if (!Array.isArray(parsed)) { untouched++; continue; }

  const next = scrubNames(parsed);
  const before = JSON.stringify(parsed);
  const after = next ? JSON.stringify(next) : null;
  if (before === after) { untouched++; continue; }

  if (after == null) willClear++;
  else willTrim++;
  changes.push({ id: row.id, before, after });
}

console.log(
  `[scrub] inspected=${inspected} clear=${willClear} trim=${willTrim} untouched=${untouched}`
);
if (verbose) {
  for (const c of changes) {
    console.log(`  ${c.id}: ${c.before} -> ${c.after ?? "NULL"}`);
  }
}

if (!apply) {
  console.log("[scrub] dry run; pass --apply to write changes.");
  await closePool();
  process.exit(0);
}

let wrote = 0;
for (const c of changes) {
  await execute(
    "UPDATE casino_table SET names_json = ? WHERE id = ?",
    [c.after, c.id]
  );
  wrote++;
}
console.log(`[scrub] applied ${wrote} updates.`);

await closePool();
