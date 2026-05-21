-- Statisticasino schema (v3).
--
-- v3 changes (2026-05-21, per user spec "admin can upload generic
-- casinodump files; generic rounds belong to a top-level Generic
-- bucket"):
--
-- * `hand_canonical.hero_seat` is now NULLABLE. Generic rounds (no
--   detectable perspective) carry NULL for hero_seat / hole cards.
-- * `casino_player` gains an implicit "Generic" row, created lazily
--   on first generic ingest (see ingest.js#GENERIC_PLAYER_NAME).
-- * Non-admin uploads still reject generic rounds. Admin uploads
--   funnel them under the Generic player. Same dedup rules apply
--   inside the Generic bucket as anywhere else.
--
-- v2 retained:
--
-- * Removed `hand_perspective` (multi-hero union table).
-- * `hand_canonical` is keyed by `(player_id, table_id, hand_dedup_id)` —
--   the same round captured from two different in-game perspectives is
--   stored as TWO rows under TWO `casino_player` parents, NOT merged.
--   Generic uploads sit independently under the Generic player and may
--   coexist with the same round under a real player.
-- * Single `hero_seat` column replaces the multi-hero `redSeats[]`
--   model. Render layer highlights at most ONE seat per hand.
-- * `casino_player` is the top-level grouping node for the /data tree.
--   Real-player names come from the dump's `userIndex`; the synthetic
--   "Generic" name is reserved for admin generic uploads.
--
-- Soft-delete + comment surfaces are unchanged across versions.
--
-- The v1 -> v2 migration DROPs every v1 hand_* table; v2 -> v3 is an
-- additive table-rebuild for hand_canonical (drops the NOT NULL on
-- hero_seat) without wiping rows. See migrate.js.

CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

-- ----------------------------------------------------------------- 
-- Top-level grouping node for the /data tree. One row per CASINO
-- screen-name we've ever observed as a perspective owner.
--
-- `name` is the casino-side display name; the special sentinel
-- "User <id>" is used when the dump has a userId for the perspective
-- seat but no resolvable username (rare).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS casino_player (
  id           TEXT PRIMARY KEY,        -- ulid-ish
  name         TEXT NOT NULL UNIQUE,
  -- The numeric casino userId, when known. Lets us reconcile if the
  -- player ever renames themselves on the casino side (a future
  -- migration could merge two `casino_player` rows by userId).
  casino_user_id INTEGER,
  first_seen_ts INTEGER NOT NULL,
  last_seen_ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_casino_player_name ON casino_player(name);
CREATE INDEX IF NOT EXISTS idx_casino_player_userid ON casino_player(casino_user_id);

-- ----------------------------------------------------------------- 
-- A round captured from a single perspective. Same `(table_id, hand_id)`
-- captured from two different perspectives -> two rows here, parented
-- under two different `casino_player`s.
--
-- Composite key is enforced via a UNIQUE index on
-- (player_id, table_id, hand_id_or_ts) — see below — rather than a
-- compound PRIMARY KEY because we still want a stable string handle
-- for URLs (`hand_key`).
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hand_canonical (
  hand_key      TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES casino_player(id) ON DELETE CASCADE,
  table_id      TEXT NOT NULL,
  hand_id       TEXT,
  -- Stable secondary identifier for the same hand at the same table:
  --   handId      when the casino server tagged it (preferred), OR
  --   "ts-<firstTs>" when there's no server-assigned id.
  -- Used by ingest's UNIQUE constraint so two re-uploads from the same
  -- player at the same hand collapse to one row, but two DIFFERENT
  -- players at the same hand stay separate.
  hand_dedup_id TEXT NOT NULL,
  first_ts      INTEGER NOT NULL,
  last_ts       INTEGER NOT NULL,
  table_names_json TEXT,
  -- Single hero seat for this row. Nullable since v3 because admin
  -- generic uploads are accepted with NULL hero (the row attaches to
  -- the synthetic Generic player; see ingest.js#GENERIC_PLAYER_NAME).
  -- Real-player rows still always have a hero_seat.
  hero_seat     INTEGER,
  hero_hole_cards_json TEXT,
  frames_blob   BLOB NOT NULL,
  content_hash  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  first_uploader_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  removed_at    INTEGER,
  removed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hand_canonical_player_round
  ON hand_canonical(player_id, table_id, hand_dedup_id);
CREATE INDEX IF NOT EXISTS idx_hand_canonical_table ON hand_canonical(table_id, last_ts DESC);
CREATE INDEX IF NOT EXISTS idx_hand_canonical_player ON hand_canonical(player_id, last_ts DESC);
CREATE INDEX IF NOT EXISTS idx_hand_canonical_first_ts ON hand_canonical(first_ts);

-- ----------------------------------------------------------------- 
-- Audit trail of every upload that ever produced or duplicated a row
-- in `hand_canonical`. Multiple uploads for the same player+round
-- collapse the canonical row but each one is recorded here so an
-- admin can see "who has uploaded what".
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hand_upload (
  id             TEXT PRIMARY KEY,
  hand_key       TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  user_id        TEXT REFERENCES user(id) ON DELETE SET NULL,
  uploaded_at    INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,
  is_canonical   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hand_upload_hand ON hand_upload(hand_key);
CREATE INDEX IF NOT EXISTS idx_hand_upload_user ON hand_upload(user_id);

CREATE TABLE IF NOT EXISTS comment (
  id         TEXT PRIMARY KEY,
  hand_key   TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  user_id    TEXT REFERENCES user(id) ON DELETE SET NULL,
  author_display TEXT,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comment_hand ON comment(hand_key, created_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '3');
