-- Statisticasino schema (v7 — MySQL).
--
-- v7 changes (2026-05-22, "email verification + hardcoded admin"):
--   * `user.password_hash` is now NULLABLE. The hardcoded admin row
--     (id `admin-hardcoded`, email `zhufengyuejohn@gmail.com`) is
--     inserted by migrate.js with `password_hash = NULL`; the auth
--     check for that email is done in code, not against the DB hash.
--   * New `email_verification` table holds short-lived 6-digit codes
--     issued during signup. The plaintext code lives only in the
--     email; we store its sha256. Rows expire 10 min after issue and
--     are deleted on first successful verify.
--   * Migration `migrateToV7()` wipes `user` (cascading sessions away)
--     and re-inserts the admin shell row. The previous env-driven
--     bootstrap path (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) is retired.
--
-- v5 retained (2026-05-22, "drop soft-delete"): hand_canonical's
-- `removed_at` / `removed_by_user_id` columns and the
-- fk_hand_canonical_remover FK are removed. Deletes are now hard
-- DELETEs that cascade to hand_upload via the existing FK. The dedup
-- bug — soft-deleted rows blocking re-uploads of the same round — goes
-- away because deleted rows no longer exist. Migration is in
-- migrate.js#migrateToV5 (info_schema-gated, idempotent, fresh-install
-- safe).
--
-- v4 retained (2026-05-22): port from SQLite to MySQL 8 (utf8mb4) on
-- Aliyun RDS. Behaviour-equivalent to v3; only dialect changes.
--
-- v3 retained (2026-05-21):
--   * `hand_canonical.hero_seat` is NULLABLE. Generic rounds (no
--     detectable perspective) carry NULL for hero_seat / hole cards.
--   * `casino_player` gains an implicit "Generic" row, created lazily
--     on first generic ingest (see ingest.js#GENERIC_PLAYER_NAME).
--   * Non-admin uploads still reject generic rounds. Admin uploads
--     funnel them under the Generic player.
--
-- v2 retained:
--   * Removed `hand_perspective` (multi-hero union table).
--   * `hand_canonical` is keyed by `(player_id, table_id, hand_dedup_id)`.
--   * `casino_player` is the top-level grouping node for the /data tree.
--
-- Dialect notes (SQLite -> MySQL):
--   * INTEGER timestamps (ms-since-epoch) -> BIGINT.
--   * INTEGER booleans -> TINYINT(1).
--   * TEXT (no length) -> VARCHAR(n) for indexed columns, TEXT/MEDIUMTEXT
--     for free-form strings, JSON for json-shaped strings.
--   * BLOB -> LONGBLOB (MySQL's BLOB caps at 65 KB; gzipped Phoenix
--     frame slabs routinely exceed that).
--   * `INSERT OR IGNORE` -> `INSERT IGNORE`.
--   * `IF NOT EXISTS` is supported on CREATE TABLE/INDEX in MySQL 8.
--   * Inline column-level `REFERENCES` -> separate `FOREIGN KEY` clauses
--     (MySQL accepts inline REFERENCES syntactically but silently
--     ignores them; only table-level FOREIGN KEY is enforced).
--
-- The migrate.js applier splits this file on `;` and runs each
-- statement. Keep statements idempotent (`CREATE TABLE IF NOT EXISTS`
-- etc.) so reboots are no-ops.

CREATE TABLE IF NOT EXISTS user (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  -- NULLABLE since v7: the hardcoded admin row carries no hash
  -- (auth check for that account is done in code, not against the DB).
  password_hash VARCHAR(255),
  display_name  VARCHAR(128),
  is_admin      TINYINT(1) NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     VARCHAR(64)  NOT NULL,
  expires_at  BIGINT NOT NULL,
  KEY idx_session_user (user_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- Top-level grouping node for the /data tree. One row per CASINO
-- screen-name we've ever observed as a perspective owner.
--
-- `name` is the casino-side display name; the special sentinel
-- "User <id>" is used when the dump has a userId for the perspective
-- seat but no resolvable username. The synthetic "[Generic]" row is
-- created lazily on first admin generic upload.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS casino_player (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL UNIQUE,
  casino_user_id  BIGINT,
  first_seen_ts   BIGINT NOT NULL,
  last_seen_ts    BIGINT NOT NULL,
  KEY idx_casino_player_name (name),
  KEY idx_casino_player_userid (casino_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- A round captured from a single perspective. Same `(table_id, hand_id)`
-- captured from two different perspectives -> two rows here, parented
-- under two different `casino_player`s.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hand_canonical (
  hand_key                VARCHAR(160) NOT NULL PRIMARY KEY,
  player_id               VARCHAR(64)  NOT NULL,
  table_id                VARCHAR(128) NOT NULL,
  hand_id                 VARCHAR(128),
  hand_dedup_id           VARCHAR(160) NOT NULL,
  first_ts                BIGINT NOT NULL,
  last_ts                 BIGINT NOT NULL,
  table_names_json        TEXT,
  hero_seat               INT,
  hero_hole_cards_json    VARCHAR(64),
  frames_blob             LONGBLOB NOT NULL,
  content_hash            CHAR(64) NOT NULL,
  created_at              BIGINT NOT NULL,
  first_uploader_user_id  VARCHAR(64),
  UNIQUE KEY uniq_hand_canonical_player_round (player_id, table_id, hand_dedup_id),
  KEY idx_hand_canonical_table (table_id, last_ts),
  KEY idx_hand_canonical_player (player_id, last_ts),
  KEY idx_hand_canonical_first_ts (first_ts),
  CONSTRAINT fk_hand_canonical_player FOREIGN KEY (player_id)
    REFERENCES casino_player(id) ON DELETE CASCADE,
  CONSTRAINT fk_hand_canonical_uploader FOREIGN KEY (first_uploader_user_id)
    REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- Audit trail of every upload that ever produced or duplicated a row
-- in `hand_canonical`. Multiple uploads for the same player+round
-- collapse the canonical row but each one is recorded here.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hand_upload (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  hand_key       VARCHAR(160) NOT NULL,
  user_id        VARCHAR(64),
  uploaded_at    BIGINT NOT NULL,
  content_hash   CHAR(64) NOT NULL,
  is_canonical   TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_hand_upload_hand (hand_key),
  KEY idx_hand_upload_user (user_id),
  CONSTRAINT fk_hand_upload_hand FOREIGN KEY (hand_key)
    REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  CONSTRAINT fk_hand_upload_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comment (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  hand_key        VARCHAR(160) NOT NULL,
  user_id         VARCHAR(64),
  author_display  VARCHAR(128),
  body            TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  removed_at      BIGINT,
  KEY idx_comment_hand (hand_key, created_at),
  CONSTRAINT fk_comment_hand FOREIGN KEY (hand_key)
    REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- Short-lived 6-digit codes issued during signup. The plaintext code
-- lives only in the email we send; the DB stores its sha256 so a
-- read-only DB leak doesn't grant signup tokens. Rows expire 10 min
-- after issue and are removed on first successful verify.
--
-- Keyed on email (not user_id) because at the time the code is sent,
-- the user account does not exist yet.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,  -- random per row, also acts as code lookup nonce
  email       VARCHAR(255) NOT NULL,
  code_hash   CHAR(64) NOT NULL,                  -- sha256 of the plaintext code
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  KEY idx_ev_email (email, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta (
  meta_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO meta(meta_key, meta_value) VALUES ('schema_version', '7');
