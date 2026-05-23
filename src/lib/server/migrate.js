// One-shot migration runner (MySQL).
//
// v7 (2026-05-22, "email verification + hardcoded admin"):
//   * `user.password_hash` is now NULLABLE.
//   * The previous env-driven admin auto-provisioning
//     (`ADMIN_EMAIL`/`ADMIN_PASSWORD` → upserted `user` row whose hash
//     was rotated on every boot) is retired. The admin's identity now
//     lives in code (`auth.js#HARDCODED_ADMIN_*`) and the DB only holds
//     a shell row (id `admin-hardcoded`, password_hash NULL, is_admin 1)
//     that exists solely so FKs in `session` / `hand_upload` /
//     `hand_canonical` can reference the admin's user_id.
//   * `migrateToV7()` (a) relaxes the password_hash NOT NULL, (b) wipes
//     every existing row in `user` (cascading sessions away, leaving
//     hand_upload.user_id and hand_canonical.first_uploader_user_id as
//     NULL via existing ON DELETE SET NULL), and (c) re-inserts the
//     admin shell row. Gated on `meta.schema_version` so a v7 DB skips
//     the wipe on subsequent boots.
//   * New `email_verification` table is created idempotently by
//     schema.sql; nothing more to do for it in the migration.
//
// v5 (2026-05-22, "drop soft-delete"):
//   * `hand_canonical.removed_at` and `removed_by_user_id` are removed,
//     along with `fk_hand_canonical_remover`. Deletes are now hard
//     DELETEs that cascade to `hand_upload` via the existing FK. The
//     migration is `migrateToV5()` below: hard-deletes any rows where
//     `removed_at IS NOT NULL`, drops the FK, then drops the columns.
//     Gated on INFORMATION_SCHEMA so it is fresh-install safe and
//     re-run safe.
//
// v4 (2026-05-22, port from SQLite to MySQL on Aliyun RDS):
//   * Schema is now MySQL 8 / utf8mb4. The `?raw` import of schema.sql
//     contains a list of `CREATE TABLE IF NOT EXISTS` statements, all
//     idempotent — calling at every boot is safe.
//   * Legacy in-place upgrade paths from v1/v2/v3 are retired; this DB
//     starts from a clean slate.
//
// Driven by the `meta.schema_version` row.

import { query, execute, getPool } from "./db.js";
import { HARDCODED_ADMIN_EMAIL, HARDCODED_ADMIN_USER_ID } from "./auth.js";

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

// MySQL doesn't accept multiple statements in a single `query` call by
// default; split on `;` and run them one at a time. Comments and blank
// lines are dropped. This is naive but safe for schema.sql because we
// don't put `;` inside string literals.
function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let _migrated = false;

export async function ensureMigrated() {
  if (_migrated) return;

  const schemaSql = await loadSchemaSql();
  const statements = splitStatements(schemaSql);
  for (const stmt of statements) {
    await query(stmt);
  }

  // Idempotent in-place upgrades. Each migration uses INFORMATION_SCHEMA
  // (or similar) to detect "already applied" so re-running is a no-op.
  await migrateToV5();
  await migrateToV7();

  // Stamp the version row (idempotent — schema.sql also INSERT IGNOREs
  // it, but we want to be defensive).
  await execute(
    "INSERT INTO meta(meta_key, meta_value) VALUES ('schema_version', '7') "
    + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)"
  );

  _migrated = true;
}

// v4 -> v5 upgrade: drop soft-delete from hand_canonical.
//
// On a v4 DB:
//   1. Hard-delete every row that was previously soft-deleted (we can't
//      preserve them once the column goes away).
//   2. Drop the fk_hand_canonical_remover FK that referenced
//      removed_by_user_id (FKs must go before their backing columns).
//   3. Drop the two columns.
//
// On a v5 DB or a fresh install (where schema.sql already produced a
// table without those columns), the INFORMATION_SCHEMA gates make
// every step a no-op. Safe to call on every boot.
async function migrateToV5() {
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hand_canonical' "
    + "  AND COLUMN_NAME IN ('removed_at', 'removed_by_user_id')"
  );
  const colNames = new Set(cols.map((r) => r.COLUMN_NAME));

  if (colNames.has("removed_at")) {
    // Hard-delete soft-deleted rows. hand_upload children cascade via FK.
    await execute("DELETE FROM hand_canonical WHERE removed_at IS NOT NULL");
  }

  // FK has to drop before its column.
  const fkRows = await query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hand_canonical' "
    + "  AND CONSTRAINT_NAME = 'fk_hand_canonical_remover'"
  );
  if (fkRows.length > 0) {
    await execute(
      "ALTER TABLE hand_canonical DROP FOREIGN KEY fk_hand_canonical_remover"
    );
  }

  for (const col of ["removed_at", "removed_by_user_id"]) {
    if (colNames.has(col)) {
      await execute(`ALTER TABLE hand_canonical DROP COLUMN ${col}`);
    }
  }
}

// v6 was reserved during a design review but never shipped; the live
// jump is v5 -> v7.
//
// v7 wipes every row in `user`, drops the NOT NULL on
// `password_hash`, and inserts the hardcoded-admin shell row. Gated
// on `meta.schema_version`: once stamped 7, the wipe never runs
// again. Idempotent in the steady state.
//
// Wiping `user` cascades:
//   * `session.user_id` (FK ON DELETE CASCADE) -> sessions disappear,
//     so every existing user gets logged out.
//   * `hand_upload.user_id` (FK ON DELETE SET NULL) -> upload audit
//     rows survive but their uploader becomes anonymous.
//   * `hand_canonical.first_uploader_user_id` (FK ON DELETE SET NULL)
//     -> same treatment.
//
// We accept the "logged-out + anonymized uploads" effect since this
// is a school project with one real user (the admin) and there is
// no separate "ordinary contributor" account to preserve.
async function migrateToV7() {
  // Read the stamped version. If meta is missing or older than 7,
  // we run the once-per-database steps; otherwise no-op.
  const versionRow = await query(
    "SELECT meta_value FROM meta WHERE meta_key = 'schema_version'"
  );
  const stamped = versionRow.length > 0
    ? parseInt(versionRow[0].meta_value, 10) || 0
    : 0;

  // Step 1: relax password_hash NOT NULL (idempotent — MySQL is
  // happy to "MODIFY" a column to a definition it already has).
  // We INFORMATION_SCHEMA-gate so a fresh install (where schema.sql
  // already produced a NULL-able column) doesn't issue an ALTER.
  const pwCol = await query(
    "SELECT IS_NULLABLE FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' "
    + "  AND COLUMN_NAME = 'password_hash'"
  );
  if (pwCol.length > 0 && pwCol[0].IS_NULLABLE === "NO") {
    await execute(
      "ALTER TABLE user MODIFY COLUMN password_hash VARCHAR(255) NULL"
    );
  }

  if (stamped < 7) {
    // Step 2: wipe every existing row in `user`. Cascades and SET NULL
    // do their thing on the dependent tables.
    await execute("DELETE FROM user");
  }

  // Step 3: ensure the hardcoded admin shell row exists (idempotent).
  // INSERT IGNORE on the email UNIQUE — re-running won't error if the
  // row was already inserted by an earlier migration pass.
  await execute(
    "INSERT IGNORE INTO user "
    + "  (id, email, password_hash, display_name, is_admin, created_at) "
    + "VALUES (?, ?, NULL, ?, 1, ?)",
    [HARDCODED_ADMIN_USER_ID, HARDCODED_ADMIN_EMAIL, "Admin", Date.now()]
  );
  // Be defensive: if a previous migration left the row with a
  // password_hash, scrub it (the auth check is hardcoded; the stored
  // hash is unused dead bytes that we don't want lingering).
  await execute(
    "UPDATE user SET password_hash = NULL, is_admin = 1 "
    + " WHERE id = ? OR email = ?",
    [HARDCODED_ADMIN_USER_ID, HARDCODED_ADMIN_EMAIL]
  );
}

// Test/CLI helper: close the pool so a script that called
// ensureMigrated can exit cleanly.
export async function shutdown() {
  const pool = await getPool();
  await pool.end();
}
