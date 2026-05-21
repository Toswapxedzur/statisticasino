// One-shot migration runner.
//
// Schema is `CREATE TABLE IF NOT EXISTS` so calling at every boot is
// safe and cheap.
//
// v1 -> v2 migration (2026-05-21):
//   The data model changed shape (multi-hero `redSeats` -> single
//   `hero_seat`, plus the new `casino_player` parent). Per the user's
//   spec "drop existing 43 rows on migrate" we don't try to back-migrate
//   the v1 data — we just DROP every v1 hand_* table and let v2 start
//   empty. `user` / `session` / `comment` are preserved.
//
//   Driven by the `meta.schema_version` row: if it's missing or "1",
//   we run the wipe; on subsequent boots schema_version is "2" and the
//   wipe is skipped.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _migrated = false;

export async function ensureMigrated() {
  if (_migrated) return;
  const db = await getDb();

  // Read the existing schema_version, if any. The `meta` table itself
  // may not exist on a brand-new DB; tolerate that.
  let version = null;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (row && row.value) version = String(row.value);
  } catch {
    version = null;
  }

  // First boot on v2 binary against a v1 (or v0) DB: wipe the hand_*
  // tables before applying the new schema. We do NOT touch `user` or
  // `session` so accounts survive the migration.
  if (version !== "2") {
    db.exec(`
      DROP TABLE IF EXISTS hand_perspective;
      DROP TABLE IF EXISTS hand_upload;
      DROP TABLE IF EXISTS hand_canonical;
      DROP TABLE IF EXISTS casino_player;
    `);
  }

  const sql = readFileSync(resolve(__dirname, "schema.sql"), "utf8");
  db.exec(sql);

  // Ensure the meta row reads "2" after migrate even if the file had
  // an older default (we INSERT OR IGNORE in schema.sql so an existing
  // value is not overwritten by the file alone).
  db.prepare(
    "INSERT INTO meta(key, value) VALUES ('schema_version', '2') "
    + "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run();

  _migrated = true;
}
