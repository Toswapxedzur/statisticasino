-- Statisticasino schema (v9 — MySQL).
--
-- v9 changes (2026-05-27, "Option B: in-band table metadata"):
--   * Naming + variant + stakes-tier are now sourced from the
--     authoritative Phoenix WebSocket `state` event payload (see
--     casinoMalwareExtension/DATA_FORMAT.md §4.1) instead of from
--     `document.title` + url-gating. The state event ships
--     `{ name, game, stakes, blinds: {small,big}, bring: {min,max},
--        rakeOptions: {...}, ante }` in-band on every join, so the
--     server can extract everything it needs from `frames_blob`
--     directly.
--   * `casino_table` gains:
--       - `stakes_tier`    — one of "low"/"mid"/"high" as the casino
--                            reports it (`state.stakes`). For pre-v9
--                            rows where no `state` snapshot was kept
--                            we derive it from the big blind via
--                            simple thresholds (see migrate.js v9).
--   * Game variant is still NOT stored: ingest only accepts Hold'em
--     (we reject on `state.game !== "holdem"`), so the variant is
--     implicitly "Hold'em" for every row that survives.
--
-- v8 retained (2026-05-27, "table-level metadata"):
--   * New `casino_table` table holds per-table metadata that used to
--     either live denormalised on every hand or wasn't captured at all:
--       - `names_json`     — array of observed lobby strings.
--       - `small_blind`,
--         `big_blind`      — numeric stakes extracted from the
--                            `blinds` action's `players[].bet` values.
--       - `betting_limit`  — one of "No Limit" / "Pot Limit" /
--                            "Fixed Limit" / "Mixed Limit". On the
--                            sole casino we currently support
--                            (replaypoker.com) this is always
--                            "No Limit" — the WS `state` payload
--                            carries no limit field but the casino
--                            only offers NL Hold'em rings.
--   * `hand_canonical.table_names_json` is dropped; tables.js now joins
--     `casino_table` to surface names + stakes + limit + tier per
--     (player, table) branch in /data.
--   * Migration `migrateToV8()` creates the table, backfills every
--     existing `(table_id)` group from `hand_canonical.table_names_json`
--     + the first stored frames_blob, then drops the old column.
--
-- v7 retained (2026-05-22, "email verification + hardcoded admin"):
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
  created_at    BIGINT NOT NULL,
  -- v10 (poker room): the single-currency "chips" wallet balance. Every
  -- change to this column is mirrored by a row in `chip_ledger`. On
  -- existing DBs these columns are added by migrateToV10 (ALTER); on a
  -- fresh install they come from this CREATE.
  chips              BIGINT NOT NULL DEFAULT 0,
  -- ms-epoch of the last daily-bonus grant, NULL if never. Used to gate
  -- the once-per-day login bonus.
  last_daily_bonus_at BIGINT,
  -- v14 (retention): consecutive-day login streak. This is VISIBLE STATUS ONLY —
  -- it does NOT change the daily bonus amount (the bonus stays flat). best_streak
  -- keeps the personal record. On existing DBs migrateToV14 adds these.
  daily_streak INT NOT NULL DEFAULT 0,
  best_streak  INT NOT NULL DEFAULT 0,
  -- v18 (Social profiles): public identity + per-user privacy. avatar_media_id
  -- references a permanent `media` row (phase S3). profile_visibility gates who
  -- sees the profile detail: public | friends | private.
  bio                VARCHAR(500),
  status_text        VARCHAR(140),
  avatar_media_id    VARCHAR(64),
  profile_visibility VARCHAR(16) NOT NULL DEFAULT 'public',
  -- v20 (money transfer): chips that may be SENT to friends — only game-earned
  -- inflows raise this; free grants never do; receiving chips does not raise it
  -- (received chips can be played but not re-forwarded). See wallet.js.
  transferable_chips BIGINT NOT NULL DEFAULT 0
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
-- Per-table metadata. One row per distinct `tableId` ever observed
-- in `hand_canonical`. The id matches `hand_canonical.table_id`
-- exactly so a join is a direct PK lookup.
--
-- `names_json` is the de-duplicated array of lobby strings we've ever
-- seen for this table. Under Option B (v9) the source is the
-- authoritative WS `state.name` field; `document.title` / `pageUrl`
-- are NOT consulted. Most tables don't rename so the array is
-- usually length 1.
--
-- `small_blind` / `big_blind` are the numeric stakes. Preferred
-- source: `state.blinds.small` / `state.blinds.big` (v9). Fallback
-- (legacy frames captured without a `state` event): extracted from
-- the `blinds` action's `players[].bet` values. They are NOT NULL
-- because the ingest path refuses to write a casino_table row
-- without resolvable blinds.
--
-- `betting_limit` is one of "No Limit" / "Pot Limit" / "Fixed Limit"
-- / "Mixed Limit". The WS `state` payload doesn't include this
-- field, but Replay Poker only offers NL Hold'em rings, so v9
-- ingest hardcodes "No Limit" for every row. The column stays NULLable
-- as a future hedge for casinos that DO carry the limit in-band.
--
-- `stakes_tier` is "low" / "mid" / "high" as `state.stakes` reports.
-- For pre-v9 rows where no `state` snapshot was preserved, the
-- v9 migration derives it from `big_blind` via a simple threshold.
--
-- Game variant is not stored — ingest only accepts Hold'em
-- (`state.game === "holdem"`).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS casino_table (
  id             VARCHAR(128) NOT NULL PRIMARY KEY,
  names_json     TEXT,
  small_blind    INT NOT NULL,
  big_blind      INT NOT NULL,
  betting_limit  VARCHAR(16),
  stakes_tier    VARCHAR(16),
  first_seen_ts  BIGINT NOT NULL,
  last_seen_ts   BIGINT NOT NULL,
  KEY idx_casino_table_stakes (big_blind, small_blind)
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
  CONSTRAINT fk_hand_canonical_table FOREIGN KEY (table_id)
    REFERENCES casino_table(id) ON DELETE CASCADE,
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

-- =================================================================
-- v10 (2026-08-16, "poker room"): the site becomes a real-time
-- multiplayer Texas Hold'em room. These tables are wholly independent
-- of the casino-capture / stats side (user/session/casino_*/hand_*),
-- which keeps working untouched.
-- =================================================================

-- -----------------------------------------------------------------
-- Append-only audit of every chips movement. The authoritative
-- balance is `user.chips`; this table is the "why" behind each change
-- and never rewritten. `delta` is signed (+credit / -debit),
-- `balance_after` is the wallet balance immediately after applying it
-- (so a full statement can be reconstructed without replaying joins).
-- `reason` is a short enum-like tag; `ref` optionally points at the
-- table / hand / admin that caused the movement.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chip_ledger (
  id             VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL,
  delta          BIGINT NOT NULL,
  balance_after  BIGINT NOT NULL,
  reason         VARCHAR(32) NOT NULL,
  ref            VARCHAR(128),
  created_at     BIGINT NOT NULL,
  -- v13: optional idempotency key for money operations that must be
  -- exactly-once even if the COMMIT acknowledgement is lost (buy-in / rebuy).
  -- The UNIQUE index makes a duplicate apply of the same logical operation
  -- fail; the caller resolves by looking the key up. NULL for ops that don't
  -- need it (grants, bonuses, cash-outs — those are idempotent by other means).
  -- Many NULLs are allowed (NULL != NULL in a MySQL unique index).
  op_key         VARCHAR(64),
  KEY idx_chip_ledger_user (user_id, created_at),
  UNIQUE KEY uq_chip_ledger_op_key (op_key),
  CONSTRAINT fk_chip_ledger_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- A live game table shown in the lobby. This is OUR table config —
-- distinct from `casino_table`, which holds metadata about scraped
-- external casino.org tables. Blinds are in chips; buy-in bounds gate
-- how much stack a player may bring. `is_active` hides a table from
-- the lobby without deleting its hand history.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poker_table (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL,
  variant      VARCHAR(32)  NOT NULL DEFAULT 'holdem',
  max_seats    INT NOT NULL DEFAULT 9,
  small_blind  INT NOT NULL,
  big_blind    INT NOT NULL,
  min_buyin    INT NOT NULL,
  max_buyin    INT NOT NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  -- v11 (PlayOK-style lobby): tables are player-created and ephemeral.
  -- `created_by` is the user who made it (NULL for legacy/house rows);
  -- `is_ephemeral` marks a player-made table; `closed_at` is set when the
  -- table empties and its live instance is torn down. The ROW is kept
  -- (poker_hand FKs to it) but the lobby only lists tables that have a
  -- live in-memory instance, so closed rows never reappear.
  created_by   VARCHAR(64),
  is_ephemeral TINYINT(1) NOT NULL DEFAULT 0,
  closed_at    BIGINT,
  KEY idx_poker_table_active (is_active, sort_order),
  CONSTRAINT fk_poker_table_creator FOREIGN KEY (created_by)
    REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- One row per COMPLETED hand played at one of our tables. `state_json`
-- is the full serialized final engine HandState (board, hole cards,
-- pots, payouts) so a hand can be replayed later. `hand_no` is a
-- per-table monotonically increasing counter.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poker_hand (
  id           VARCHAR(64) NOT NULL PRIMARY KEY,
  table_id     VARCHAR(64) NOT NULL,
  hand_no      BIGINT NOT NULL,
  button_seat  INT,
  board_json   VARCHAR(64),
  pot_total    BIGINT NOT NULL DEFAULT 0,
  started_at   BIGINT NOT NULL,
  ended_at     BIGINT NOT NULL,
  state_json   MEDIUMTEXT,
  KEY idx_poker_hand_table (table_id, ended_at),
  CONSTRAINT fk_poker_hand_table FOREIGN KEY (table_id)
    REFERENCES poker_table(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- Per-seat outcome of a completed hand: which site account sat there,
-- their hole cards, and net chips won/lost. Drives per-player hand
-- history and accounting. `user_id` is SET NULL if the account is
-- later deleted so the hand row survives.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poker_hand_player (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  hand_id     VARCHAR(64) NOT NULL,
  user_id     VARCHAR(64),
  seat        INT NOT NULL,
  display_name VARCHAR(128),
  hole_cards  VARCHAR(8),
  net         BIGINT NOT NULL DEFAULT 0,
  KEY idx_php_hand (hand_id),
  KEY idx_php_user (user_id, hand_id),
  CONSTRAINT fk_php_hand FOREIGN KEY (hand_id)
    REFERENCES poker_hand(id) ON DELETE CASCADE,
  CONSTRAINT fk_php_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v12: crash-safe escrow. Chips leave the wallet when a player sits and
-- live as an in-memory seat stack; this table mirrors that "in play"
-- amount durably so a hard crash can't destroy chips. One row per seated
-- player (a seat holds at most one). The invariant is wallet + escrow =
-- constant at every committed state: the escrow upsert/delete is written
-- in the SAME transaction as the wallet debit/credit (see bank.js). On
-- boot, reconcileEscrowOnBoot() refunds every row to its wallet and
-- clears the table (ephemeral tables are not rebuilt).
-- -----------------------------------------------------------------
-- FKs are ON DELETE RESTRICT (not CASCADE): escrow is chip custody, so a user
-- or table row must NOT be deletable while it still backs a live seat stack —
-- a cascade would silently destroy chips that the in-memory LiveTable is still
-- holding. Deleting an account/table must settle or forfeit its escrow first.
CREATE TABLE IF NOT EXISTS poker_escrow (
  table_id    VARCHAR(64) NOT NULL,
  seat_no     INT         NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  stack       BIGINT      NOT NULL,
  updated_at  BIGINT      NOT NULL,
  PRIMARY KEY (table_id, seat_no),
  KEY idx_poker_escrow_user (user_id),
  CONSTRAINT fk_poker_escrow_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_poker_escrow_table FOREIGN KEY (table_id)
    REFERENCES poker_table(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v14 (2026-08-24, "retention"): unlocked achievements. Pure STATUS —
-- badges only, they grant no chips. The achievement catalog (keys,
-- names, descriptions, how each is earned) lives in code
-- (server/achievements.js); this table only records which user unlocked
-- which and when. One row per (user, achievement); the PK makes an
-- unlock idempotent (INSERT IGNORE).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_achievement (
  user_id      VARCHAR(64) NOT NULL,
  achievement  VARCHAR(48) NOT NULL,
  unlocked_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, achievement),
  KEY idx_user_achievement_user (user_id, unlocked_at),
  CONSTRAINT fk_user_achievement_user FOREIGN KEY (user_id)
    REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v15 (2026-08-24, "friends"): the friend graph. One row per relation,
-- DIRECTED by who sent the request (requester → addressee) but treated
-- as undirected once `status = 'accepted'`. `pending` is an outstanding
-- request the addressee hasn't answered. The PK prevents a duplicate
-- A→B row; a reciprocal B→A request is auto-accepted in code
-- (friends.js#requestFriend). Deleting either account removes the edge.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendship (
  requester_id  VARCHAR(64) NOT NULL,
  addressee_id  VARCHAR(64) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted'
  created_at    BIGINT NOT NULL,
  responded_at  BIGINT,
  PRIMARY KEY (requester_id, addressee_id),
  KEY idx_friendship_addressee (addressee_id, status),
  KEY idx_friendship_requester (requester_id, status),
  CONSTRAINT fk_friendship_requester FOREIGN KEY (requester_id)
    REFERENCES user(id) ON DELETE CASCADE,
  CONSTRAINT fk_friendship_addressee FOREIGN KEY (addressee_id)
    REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v16 (2026-08-24, "friend DMs"): private 1:1 messages between friends.
-- `pair_key` is min(from,to)+"|"+max(from,to) so an entire conversation
-- (both directions) is one indexed range scan. `read_at` is set on the
-- RECIPIENT's rows when they open the thread (drives unread badges).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_message (
  id           VARCHAR(64) NOT NULL PRIMARY KEY,
  -- Monotonic insertion order — the sort key for a thread. created_at (ms) can
  -- tie for rapid messages, so we order by seq to keep threads stable.
  seq          BIGINT NOT NULL AUTO_INCREMENT,
  pair_key     VARCHAR(160) NOT NULL,
  from_user_id VARCHAR(64) NOT NULL,
  to_user_id   VARCHAR(64) NOT NULL,
  body         VARCHAR(2000) NOT NULL,
  created_at   BIGINT NOT NULL,
  read_at      BIGINT,
  UNIQUE KEY uq_dm_seq (seq),
  KEY idx_dm_pair (pair_key, seq),
  KEY idx_dm_unread (to_user_id, read_at),
  CONSTRAINT fk_dm_from FOREIGN KEY (from_user_id) REFERENCES user(id) ON DELETE CASCADE,
  CONSTRAINT fk_dm_to FOREIGN KEY (to_user_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v17 (2026-08-26, "Social"): unified conversation model. A conversation is
-- either a 1:1 DM (kind='dm', two members, `dm_key` = sorted pair) or a group
-- (kind='group', N members, a title + optional avatar). One code path serves
-- both. Legacy `dm_message` rows are backfilled into conversations by
-- migrateToV17. Read state is per-member `last_read_seq` (unread = messages
-- with a higher seq not sent by me), which generalises cleanly to groups.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation (
  id              VARCHAR(64) NOT NULL PRIMARY KEY,
  kind            VARCHAR(16) NOT NULL,            -- 'dm' | 'group'
  title           VARCHAR(128),                    -- group name (NULL for dm)
  avatar_media_id VARCHAR(64),                     -- group avatar (S3 media, phase S3)
  dm_key          VARCHAR(160),                    -- dm: sorted "a|b", NULL for group
  created_by      VARCHAR(64),
  created_at      BIGINT NOT NULL,
  last_msg_at     BIGINT,                          -- newest message ts, for chat-list sort
  UNIQUE KEY uq_conv_dm_key (dm_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_member (
  conv_id       VARCHAR(64) NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  joined_at     BIGINT NOT NULL,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conv_id, user_id),
  KEY idx_cm_user (user_id),
  CONSTRAINT fk_cm_conv FOREIGN KEY (conv_id) REFERENCES conversation(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_message (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  seq         BIGINT NOT NULL AUTO_INCREMENT,
  conv_id     VARCHAR(64) NOT NULL,
  sender_id   VARCHAR(64),                          -- NULL = system message
  kind        VARCHAR(16) NOT NULL DEFAULT 'text',  -- 'text'|'image'|'file'|'system'
  body        VARCHAR(4000),
  media_id    VARCHAR(64),                          -- attachment (S3 media, phase S3)
  reply_to    VARCHAR(64),
  created_at  BIGINT NOT NULL,
  edited_at   BIGINT,
  deleted_at  BIGINT,
  UNIQUE KEY uq_chat_seq (seq),
  KEY idx_chat_conv (conv_id, seq),
  CONSTRAINT fk_chat_conv FOREIGN KEY (conv_id) REFERENCES conversation(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------
-- v19 (2026-08-26, "Social media"): uploaded media — avatars (permanent) and
-- chat attachments (ephemeral, 3-day TTL). The bytes live in object storage
-- (Aliyun OSS); this table is the index + lifecycle record. `expires_at` NULL
-- means permanent (avatars); attachments get now+3d and are swept by the janitor
-- (media.js cleanupExpired). `storage_key` is the OSS object key.
-- NOTE: media features are gated on OSS being configured + activated; until then
-- uploads are disabled at the route layer.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id           VARCHAR(64) NOT NULL PRIMARY KEY,
  uploader_id  VARCHAR(64),
  kind         VARCHAR(16) NOT NULL,             -- 'avatar' | 'attachment'
  mime         VARCHAR(128),
  bytes        BIGINT NOT NULL DEFAULT 0,
  storage_key  VARCHAR(255) NOT NULL,
  created_at   BIGINT NOT NULL,
  expires_at   BIGINT,                            -- NULL = permanent
  ready        TINYINT(1) NOT NULL DEFAULT 0,     -- set once the client confirms upload
  KEY idx_media_expiry (expires_at),
  KEY idx_media_uploader (uploader_id, created_at),
  CONSTRAINT fk_media_uploader FOREIGN KEY (uploader_id) REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v21 (2026-08-26, "Social safety"): blocking + reporting. A block is directed
-- (blocker -> blocked) but enforced BOTH ways (no DMs / friend requests either
-- direction). Reports land in a queue for admin review.
CREATE TABLE IF NOT EXISTS user_block (
  blocker_id  VARCHAR(64) NOT NULL,
  blocked_id  VARCHAR(64) NOT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_block_blocked (blocked_id),
  CONSTRAINT fk_block_blocker FOREIGN KEY (blocker_id) REFERENCES user(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_blocked FOREIGN KEY (blocked_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report (
  id           VARCHAR(64) NOT NULL PRIMARY KEY,
  reporter_id  VARCHAR(64),
  target_id    VARCHAR(64),
  reason       VARCHAR(500),
  created_at   BIGINT NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'open',   -- open | reviewed
  KEY idx_report_status (status, created_at),
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES user(id) ON DELETE SET NULL,
  CONSTRAINT fk_report_target FOREIGN KEY (target_id) REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta (
  meta_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO meta(meta_key, meta_value) VALUES ('schema_version', '16');
