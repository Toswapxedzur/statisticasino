-- Statisticasino schema (v1).
--
-- Design notes:
--
-- * `hand_canonical` is the immutable, first-upload-wins record per
--   `(table_id, hand_id)`. Its `frames_json` is the gzipped JSON envelope
--   from the FIRST upload. Subsequent uploads do NOT overwrite it.
-- * `hand_upload` records every upload regardless of whether it was the
--   first or a duplicate-perspective. Each upload carries its perspective
--   seat id + (when known) its uploader user id, so the rendering layer
--   can pull the full set of red-highlighted seats.
-- * `hand_perspective` is a derived join of (hand_canonical, seat_id) ->
--   the set of uploads that contributed that perspective. Populated by
--   the ingest endpoint as a UNIQUE row per (hand_key, seat_id) so the
--   data page can fetch "all reds for this hand" in O(1) per hand.
-- * Comments live on a hand. Anonymous comments are allowed (user_id NULL)
--   per the user's spec ("everyone can upload comment").

CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,            -- ulid-ish
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,               -- argon2id (encoded string)
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL             -- epoch ms
);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,              -- sha-256 hash of the cookie token
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL               -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS hand_canonical (
  hand_key      TEXT PRIMARY KEY,            -- "<tableId>::<handId>" (or "<tableId>::ts-<ts>")
  table_id      TEXT NOT NULL,
  hand_id       TEXT,                        -- server-side hand id; null only for the ts-fallback shape
  first_ts      INTEGER NOT NULL,
  last_ts       INTEGER NOT NULL,
  table_names_json TEXT,                     -- JSON array of names seen for this table over time
  frames_blob   BLOB NOT NULL,               -- gzipped JSON of the frames[]; opaque to SQL
  content_hash  TEXT NOT NULL,               -- sha-256 of the canonical envelope body
  created_at    INTEGER NOT NULL,            -- when we first ingested it
  first_uploader_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  -- soft-delete: an admin / authed user can mark a canonical hand as
  -- removed; the row stays for audit but the rendering layer filters it.
  removed_at    INTEGER,
  removed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_hand_canonical_table ON hand_canonical(table_id, last_ts DESC);
CREATE INDEX IF NOT EXISTS idx_hand_canonical_first_ts ON hand_canonical(first_ts);

CREATE TABLE IF NOT EXISTS hand_upload (
  id             TEXT PRIMARY KEY,
  hand_key       TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  -- The seat id this upload was authored from. Null only if perspective
  -- detection couldn't pin a single seat (e.g. all seats masked, very rare).
  perspective_seat_id INTEGER,
  -- Cards revealed for this perspective (the seat's two hole cards as a
  -- JSON array of strings like ["Ah","Kd"]). Stored separately from
  -- frames_blob so the canonical envelope stays untouched but the merge
  -- query can union perspective reveals cheaply.
  hole_cards_json     TEXT,
  user_id        TEXT REFERENCES user(id) ON DELETE SET NULL,  -- null = anonymous upload
  uploaded_at    INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,              -- sha-256 of THIS upload's bytes (for dedup detection)
  -- Was this the canonical-creating upload? (1 = yes, 0 = it merged into
  -- an existing canonical record contributing only perspective bytes.)
  is_canonical   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hand_upload_hand ON hand_upload(hand_key);
CREATE INDEX IF NOT EXISTS idx_hand_upload_user ON hand_upload(user_id);

-- Materialised view of perspective owners per hand. Lets the data page
-- pull "list of red seats" with one row-per-perspective without parsing
-- frames_blob at render time. Updated by ingest as a side-effect.
CREATE TABLE IF NOT EXISTS hand_perspective (
  hand_key TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  seat_id  INTEGER NOT NULL,
  -- ONE row per (hand_key, seat_id) regardless of how many uploads
  -- contributed that perspective; uploader info lives in hand_upload.
  hole_cards_json TEXT,
  first_seen_upload_id TEXT REFERENCES hand_upload(id) ON DELETE SET NULL,
  PRIMARY KEY (hand_key, seat_id)
);

CREATE TABLE IF NOT EXISTS comment (
  id         TEXT PRIMARY KEY,
  hand_key   TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
  user_id    TEXT REFERENCES user(id) ON DELETE SET NULL,   -- null = anonymous
  author_display TEXT,                                       -- frozen at write time
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER                                          -- soft-delete by admin
);
CREATE INDEX IF NOT EXISTS idx_comment_hand ON comment(hand_key, created_at);

-- Generic key/value cache. Currently only used to remember which schema
-- version is applied; lets us add migrations later without re-running
-- everything from scratch.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
