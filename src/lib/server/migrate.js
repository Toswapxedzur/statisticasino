// One-shot migration runner (MySQL).
//
// v9 (2026-05-27, "Option B: in-band metadata"):
//   * Adds `casino_table.stakes_tier VARCHAR(16) NULL`.
//   * For every existing casino_table row, fills the new column from
//     the big blind via `deriveStakesTierFromBlinds` (BB ≤ 10 → "low"
//     etc.). The casino we currently support (replaypoker.com) only
//     ever served us "low" tier tables (1/2, 2/4, 5/10) so the live
//     migration ends up setting every existing row to "low". The
//     threshold-based derivation is future-proof for mid/high tier
//     captures we haven't seen yet.
//   * Also fills `betting_limit` with "No Limit" for any row that
//     still has NULL (e.g. the historically-nameless tables that the
//     v8 backfill couldn't classify). Per the v9 design note,
//     Replay Poker is NL-only so this is correct for every legacy
//     row. The COALESCE pattern leaves any explicitly-set non-NULL
//     value untouched.
//   * Gated end-to-end on INFORMATION_SCHEMA so re-runs are no-ops.
//
// v8 (2026-05-27, "table-level metadata"):
//   * Introduces `casino_table` (see schema.sql) — one row per
//     distinct tableId, carrying names, small/big blind, and
//     betting-limit string.
//   * Migration `migrateToV8()` (a) ensures `casino_table` exists,
//     (b) backfills one row per distinct `hand_canonical.table_id`
//     by parsing the existing `table_names_json` for the betting-
//     limit suffix and decompressing one `frames_blob` per table for
//     the numeric blinds, (c) DELETEs any hand whose table couldn't
//     be backfilled (no `blinds` frame -> no stakes -> would violate
//     the new NOT NULL on small_blind/big_blind), (d) adds the
//     `fk_hand_canonical_table` FK, (e) drops the now-redundant
//     `hand_canonical.table_names_json` column. Gated end-to-end on
//     INFORMATION_SCHEMA so re-runs and fresh installs are no-ops.
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

import { gunzipSync } from "node:zlib";
import { query, execute, getPool } from "./db.js";
import { HARDCODED_ADMIN_EMAIL, HARDCODED_ADMIN_USER_ID } from "./auth.js";
import {
  extractStakeFromFrames,
  parseBettingLimitFromNames,
  deriveStakesTierFromBlinds
} from "./table-meta.js";

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
  await migrateToV8();
  await migrateToV9();
  await migrateToV10();
  await migrateToV11();
  await migrateToV12();
  await migrateToV13();

  // Stamp the version row (idempotent — schema.sql also INSERT IGNOREs
  // it, but we want to be defensive).
  await execute(
    "INSERT INTO meta(meta_key, meta_value) VALUES ('schema_version', '13') "
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

// v7 -> v8 upgrade: lift per-table metadata into a new `casino_table`
// row and drop the denormalised `hand_canonical.table_names_json`
// column. See top-of-file comment for the full sequence.
//
// Idempotent: every step is INFORMATION_SCHEMA-gated and the backfill
// uses INSERT ... ON DUPLICATE KEY UPDATE so re-running is safe.
async function migrateToV8() {
  // schema.sql (CREATE TABLE IF NOT EXISTS casino_table) has already
  // run by the time we get here, so the table exists either way.
  // We still gate the rest of the migration on the legacy column —
  // its presence is the v7-DB signal.
  const legacyCol = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hand_canonical' "
    + "  AND COLUMN_NAME = 'table_names_json'"
  );
  if (legacyCol.length === 0) return;          // already on v8 (or fresh install)

  // Step 1: for each distinct table_id, gather names + a sample
  // frames_blob and write one casino_table row.
  //
  // We pick the EARLIEST canonical row per table for the sample blob
  // so the blinds we record correspond to the first observation. Most
  // cash tables have constant blinds across hands; tournaments would
  // need a per-hand model, which we don't support today.
  const aggRows = await query(
    `SELECT
       c.table_id                AS table_id,
       MIN(c.first_ts)           AS first_seen_ts,
       MAX(c.last_ts)            AS last_seen_ts,
       (SELECT inner_c.frames_blob
          FROM hand_canonical inner_c
          WHERE inner_c.table_id = c.table_id
          ORDER BY inner_c.first_ts ASC
          LIMIT 1)                AS sample_blob
     FROM hand_canonical c
     GROUP BY c.table_id`
  );

  // Fetch all observed names per table separately (avoids the
  // GROUP_CONCAT-with-JSON quoting hazard).
  const nameRows = await query(
    `SELECT table_id, table_names_json
       FROM hand_canonical
       WHERE table_names_json IS NOT NULL`
  );
  const namesByTable = new Map();
  for (const r of nameRows) {
    let arr;
    try { arr = JSON.parse(r.table_names_json); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    let bucket = namesByTable.get(r.table_id);
    if (!bucket) { bucket = []; namesByTable.set(r.table_id, bucket); }
    for (const n of arr) {
      if (typeof n === "string" && n && bucket.indexOf(n) === -1) bucket.push(n);
    }
  }

  const orphanTableIds = [];
  for (const t of aggRows) {
    const names = namesByTable.get(t.table_id) || [];
    let stake = null;
    try {
      if (t.sample_blob) {
        const frames = JSON.parse(gunzipSync(t.sample_blob).toString("utf8"));
        stake = extractStakeFromFrames(frames);
      }
    } catch {
      stake = null;
    }
    if (!stake) {
      // No deducible blinds -> can't satisfy the new NOT NULL columns.
      // Hands at this table get hard-deleted below.
      orphanTableIds.push(t.table_id);
      continue;
    }
    const bettingLimit = parseBettingLimitFromNames(names);
    await execute(
      `INSERT INTO casino_table
         (id, names_json, small_blind, big_blind, betting_limit,
          first_seen_ts, last_seen_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         names_json    = VALUES(names_json),
         small_blind   = VALUES(small_blind),
         big_blind     = VALUES(big_blind),
         betting_limit = VALUES(betting_limit),
         first_seen_ts = LEAST(first_seen_ts, VALUES(first_seen_ts)),
         last_seen_ts  = GREATEST(last_seen_ts, VALUES(last_seen_ts))`,
      [
        t.table_id,
        names.length ? JSON.stringify(names) : null,
        stake.smallBlind,
        stake.bigBlind,
        bettingLimit,
        Number(t.first_seen_ts) || Date.now(),
        Number(t.last_seen_ts) || Date.now()
      ]
    );
  }

  // Step 2: drop hands belonging to orphan tables. There's no row in
  // casino_table for them, so the FK we're about to add would reject
  // every one of them. hand_upload children cascade.
  for (const tid of orphanTableIds) {
    await execute("DELETE FROM hand_canonical WHERE table_id = ?", [tid]);
  }

  // Step 3: add the FK if it isn't already there.
  const fkRows = await query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hand_canonical' "
    + "  AND CONSTRAINT_NAME = 'fk_hand_canonical_table'"
  );
  if (fkRows.length === 0) {
    await execute(
      "ALTER TABLE hand_canonical "
      + "  ADD CONSTRAINT fk_hand_canonical_table FOREIGN KEY (table_id) "
      + "    REFERENCES casino_table(id) ON DELETE CASCADE"
    );
  }

  // Step 4: drop the legacy column.
  await execute("ALTER TABLE hand_canonical DROP COLUMN table_names_json");
}

// v8 -> v9 upgrade: stash Option B side-data on `casino_table` and
// blanket-fill the legacy NL-Hold'em assumption for pre-v9 rows.
//
// Idempotent in two layers:
//   * The ALTER TABLE is gated on INFORMATION_SCHEMA so it only runs
//     once.
//   * The UPDATEs use COALESCE so rows that already have a value
//     (set on first ingest under v9) keep it; only NULL columns get
//     written.
async function migrateToV9() {
  // Step 1: add stakes_tier column if it isn't there yet.
  const tierCol = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'casino_table' "
    + "  AND COLUMN_NAME = 'stakes_tier'"
  );
  if (tierCol.length === 0) {
    await execute(
      "ALTER TABLE casino_table ADD COLUMN stakes_tier VARCHAR(16) NULL "
      + "  AFTER betting_limit"
    );
  }

  // Step 2: blanket NL Hold'em assumption for legacy rows. The
  // historically-nameless tables (no `state` snapshot at the time
  // of capture) have betting_limit = NULL — fill them with the
  // assumption now that we've decided Replay Poker is NL-only.
  //
  // We do NOT touch rows whose betting_limit was already set by the
  // v8 name-parsing backfill — those values were derived from real
  // signal and stay authoritative.
  await execute(
    "UPDATE casino_table "
    + "   SET betting_limit = 'No Limit' "
    + " WHERE betting_limit IS NULL"
  );

  // Step 3: derive stakes_tier from big_blind for every row that
  // doesn't have one. The derivation is centralised in
  // table-meta.js so the live ingest path uses the exact same
  // thresholds.
  const rows = await query(
    "SELECT id, big_blind FROM casino_table WHERE stakes_tier IS NULL"
  );
  for (const r of rows) {
    const tier = deriveStakesTierFromBlinds(r.big_blind);
    if (!tier) continue;     // shouldn't happen — big_blind is NOT NULL
    await execute(
      "UPDATE casino_table SET stakes_tier = ? WHERE id = ?",
      [tier, r.id]
    );
  }
}

// v9 -> v10 upgrade: the poker room. Adds the `chips` wallet columns to
// `user` and (via schema.sql's CREATE TABLE IF NOT EXISTS) the
// chip_ledger / poker_table / poker_hand / poker_hand_player tables.
//
// Only the `user` ALTERs need imperative handling here — the new tables
// are created idempotently by schema.sql before this runs. Every step is
// INFORMATION_SCHEMA-gated so fresh installs and re-runs are no-ops.
//
// Note: existing accounts get chips = 0 (the column default). The
// starting-grant is applied lazily at first login / on demand by the
// wallet layer, not backfilled here, so the ledger stays the single
// source of truth for "why does this user have chips".
async function migrateToV10() {
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' "
    + "  AND COLUMN_NAME IN ('chips', 'last_daily_bonus_at')"
  );
  const have = new Set(cols.map((r) => r.COLUMN_NAME));

  if (!have.has("chips")) {
    await execute(
      "ALTER TABLE user ADD COLUMN chips BIGINT NOT NULL DEFAULT 0 AFTER created_at"
    );
  }
  if (!have.has("last_daily_bonus_at")) {
    await execute(
      "ALTER TABLE user ADD COLUMN last_daily_bonus_at BIGINT NULL AFTER chips"
    );
  }
}

// v10 -> v11 upgrade: PlayOK-style ephemeral, player-created tables.
//
// Adds `created_by` / `is_ephemeral` / `closed_at` to poker_table and the
// creator FK. Also RETIRES the old admin-seeded fixed tables (created_by
// NULL, is_ephemeral 0, still open) by marking them inactive+closed, since
// the new lobby only lists player-created tables. Their rows stay for
// poker_hand FK integrity. Every step is INFORMATION_SCHEMA-gated so
// re-runs and fresh installs are no-ops.
async function migrateToV11() {
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poker_table' "
    + "  AND COLUMN_NAME IN ('created_by', 'is_ephemeral', 'closed_at')"
  );
  const have = new Set(cols.map((r) => r.COLUMN_NAME));

  if (!have.has("created_by")) {
    await execute("ALTER TABLE poker_table ADD COLUMN created_by VARCHAR(64) NULL AFTER created_at");
  }
  if (!have.has("is_ephemeral")) {
    await execute("ALTER TABLE poker_table ADD COLUMN is_ephemeral TINYINT(1) NOT NULL DEFAULT 0 AFTER created_by");
  }
  if (!have.has("closed_at")) {
    await execute("ALTER TABLE poker_table ADD COLUMN closed_at BIGINT NULL AFTER is_ephemeral");
  }

  // Add the creator FK if it isn't present yet.
  const fk = await query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poker_table' "
    + "  AND CONSTRAINT_NAME = 'fk_poker_table_creator'"
  );
  if (fk.length === 0) {
    await execute(
      "ALTER TABLE poker_table ADD CONSTRAINT fk_poker_table_creator "
      + "FOREIGN KEY (created_by) REFERENCES user(id) ON DELETE SET NULL"
    );
  }

  // Retire legacy seeded/house tables — the pure-ephemeral lobby doesn't
  // list them. Only touch still-open, non-ephemeral, creator-less rows.
  await execute(
    "UPDATE poker_table SET is_active = 0, closed_at = ? "
    + "WHERE is_ephemeral = 0 AND created_by IS NULL AND closed_at IS NULL",
    [Date.now()]
  );
}

// v11 -> v12 upgrade: crash-safe escrow. The `poker_escrow` table is
// created by the schema.sql pass above (CREATE TABLE IF NOT EXISTS runs on
// every boot, so existing DBs get it too); this function exists to keep the
// migration chain explicit and version-stamped. Idempotent by construction.
async function migrateToV12() {
  const rows = await query(
    "SELECT TABLE_NAME FROM information_schema.TABLES "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poker_escrow'"
  );
  if (rows.length === 0) {
    await execute(
      "CREATE TABLE IF NOT EXISTS poker_escrow ("
      + " table_id VARCHAR(64) NOT NULL, seat_no INT NOT NULL,"
      + " user_id VARCHAR(64) NOT NULL, stack BIGINT NOT NULL,"
      + " updated_at BIGINT NOT NULL, PRIMARY KEY (table_id, seat_no),"
      + " KEY idx_poker_escrow_user (user_id),"
      + " CONSTRAINT fk_poker_escrow_user FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE RESTRICT,"
      + " CONSTRAINT fk_poker_escrow_table FOREIGN KEY (table_id) REFERENCES poker_table(id) ON DELETE RESTRICT"
      + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    return;
  }
  // Escrow existed from an interim build with ON DELETE CASCADE — a cascade
  // would silently destroy chips still held by a live seat. Rebuild the FKs as
  // RESTRICT. Idempotent: only acts on FKs whose DELETE_RULE is CASCADE.
  const fks = await query(
    "SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE "
    + "FROM information_schema.REFERENTIAL_CONSTRAINTS rc "
    + "WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = 'poker_escrow'"
  );
  const has = (name) => fks.some((f) => f.CONSTRAINT_NAME === name);
  const ruleFor = (name) => fks.find((f) => f.CONSTRAINT_NAME === name)?.DELETE_RULE;
  // Ensure each FK exists AND is RESTRICT. Handling the MISSING case (not just
  // CASCADE) makes this self-healing if a prior run crashed between DROP and
  // ADD (DDL auto-commits, so the constraint could be absent).
  const ensureRestrict = async (name, col, ref) => {
    if (has(name)) {
      if (ruleFor(name) !== "CASCADE") return; // already RESTRICT/NO ACTION
      await execute(`ALTER TABLE poker_escrow DROP FOREIGN KEY ${name}`);
    }
    await execute(
      `ALTER TABLE poker_escrow ADD CONSTRAINT ${name} `
      + `FOREIGN KEY (${col}) REFERENCES ${ref} ON DELETE RESTRICT`
    );
  };
  await ensureRestrict("fk_poker_escrow_user", "user_id", "user(id)");
  await ensureRestrict("fk_poker_escrow_table", "table_id", "poker_table(id)");
}

// v12 -> v13 upgrade: idempotency keys on chip_ledger. Adds the nullable
// `op_key` column + its UNIQUE index so buy-in/rebuy can be exactly-once across
// a lost COMMIT acknowledgement. Both steps INFORMATION_SCHEMA-gated.
async function migrateToV13() {
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chip_ledger' AND COLUMN_NAME = 'op_key'"
  );
  if (cols.length === 0) {
    await execute("ALTER TABLE chip_ledger ADD COLUMN op_key VARCHAR(64) NULL AFTER ref");
  }
  const idx = await query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chip_ledger' AND INDEX_NAME = 'uq_chip_ledger_op_key'"
  );
  if (idx.length === 0) {
    await execute("ALTER TABLE chip_ledger ADD UNIQUE KEY uq_chip_ledger_op_key (op_key)");
  }
}

// Test/CLI helper: close the pool so a script that called
// ensureMigrated can exit cleanly.
export async function shutdown() {
  const pool = await getPool();
  await pool.end();
}
