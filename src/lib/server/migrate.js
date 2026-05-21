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
// v2 -> v3 migration (2026-05-21, "admin can upload generic dumps"):
//   `hand_canonical.hero_seat` becomes nullable (generic rounds carry
//   NULL hero). SQLite has no `ALTER COLUMN`, so we do the canonical
//   table-rebuild dance:
//     1. CREATE the new shape under a tmp name
//     2. INSERT INTO ... SELECT * FROM the old table
//     3. DROP the old table, RENAME tmp -> hand_canonical
//     4. Recreate the indexes the schema.sql idempotent block also
//        creates (the SELECT preserves rows but indexes are tied to
//        the old name and dropped with it).
//   Other tables (user / session / casino_player / comment / hand_upload)
//   are unchanged.
//
// Driven by the `meta.schema_version` row.

import { getDb } from "./db.js";

// schema.sql resolution has TWO callers:
//
//   1. The SvelteKit production build (Vite bundles this file into
//      build/server/chunks/, where the sibling `schema.sql` does NOT
//      get copied). Without an inlined string, ensureMigrated 500s
//      on every request.
//   2. Smoke scripts (scripts/smoke-*.js) that import migrate.js
//      directly via Node's native ESM loader. Node has no concept
//      of Vite's `?raw` query and throws ERR_UNKNOWN_FILE_EXTENSION.
//
// We cover both by trying the Vite-style raw import first (it's
// rewritten at build time, so the catch path is never taken in
// production) and falling back to fs.readFileSync for raw Node.
async function loadSchemaSql() {
  try {
    const mod = await import("./schema.sql?raw");
    return mod.default;
  } catch {
    const [{ readFileSync }, { fileURLToPath }, { dirname, resolve }] =
      await Promise.all([
        import("node:fs"),
        import("node:url"),
        import("node:path")
      ]);
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(resolve(here, "schema.sql"), "utf8");
  }
}

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
  if (version !== "2" && version !== "3") {
    db.exec(`
      DROP TABLE IF EXISTS hand_perspective;
      DROP TABLE IF EXISTS hand_upload;
      DROP TABLE IF EXISTS hand_canonical;
      DROP TABLE IF EXISTS casino_player;
    `);
  }

  // v2 -> v3: rebuild hand_canonical with nullable hero_seat.
  // Only fires when there's actually a v2 hand_canonical to rebuild
  // (the wipe branch above already produced a fresh DB at v0/v1, in
  // which case schema.sql below creates the v3 shape directly).
  if (version === "2") {
    db.exec(`
      CREATE TABLE hand_canonical_new (
        hand_key      TEXT PRIMARY KEY,
        player_id     TEXT NOT NULL REFERENCES casino_player(id) ON DELETE CASCADE,
        table_id      TEXT NOT NULL,
        hand_id       TEXT,
        hand_dedup_id TEXT NOT NULL,
        first_ts      INTEGER NOT NULL,
        last_ts       INTEGER NOT NULL,
        table_names_json TEXT,
        hero_seat     INTEGER,
        hero_hole_cards_json TEXT,
        frames_blob   BLOB NOT NULL,
        content_hash  TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        first_uploader_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
        removed_at    INTEGER,
        removed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL
      );
      INSERT INTO hand_canonical_new
        SELECT hand_key, player_id, table_id, hand_id, hand_dedup_id,
               first_ts, last_ts, table_names_json,
               hero_seat, hero_hole_cards_json,
               frames_blob, content_hash, created_at,
               first_uploader_user_id, removed_at, removed_by_user_id
          FROM hand_canonical;
      DROP TABLE hand_canonical;
      ALTER TABLE hand_canonical_new RENAME TO hand_canonical;
    `);
    // Indexes are recreated by schema.sql below via CREATE INDEX IF
    // NOT EXISTS — they were dropped along with the old table.
  }

  const schemaSql = await loadSchemaSql();
  db.exec(schemaSql);

  // Ensure the meta row reads "3" after migrate even if the file had
  // an older default (we INSERT OR IGNORE in schema.sql so an existing
  // value is not overwritten by the file alone).
  db.prepare(
    "INSERT INTO meta(key, value) VALUES ('schema_version', '3') "
    + "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run();

  _migrated = true;
}
