// Smoke test for the v2 -> v3 schema migration.
//
// Constructs a v2 DB by hand (the exact pre-migration shape), inserts
// a row with hero_seat = 5, then boots ensureMigrated() and asserts:
//
//   1. schema_version flips to "3"
//   2. The original row's data survives unchanged
//   3. hero_seat is now NULLABLE — i.e. an INSERT of a NULL hero
//      succeeds (which would have failed under v2's NOT NULL).
//
// Run with: node scripts/smoke-migrate.js

import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const SMOKE_DB = resolve(process.cwd(), "smoke-migrate.sqlite");
process.env.DATABASE_PATH = SMOKE_DB;
if (existsSync(SMOKE_DB)) unlinkSync(SMOKE_DB);

// Hand-build a v2 schema (verbatim from the v2 schema.sql, simplified
// to the pieces we touch in migrate).
const seed = new Database(SMOKE_DB);
seed.exec(`
  CREATE TABLE user (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE session (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );
  CREATE TABLE casino_player (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    casino_user_id INTEGER,
    first_seen_ts INTEGER NOT NULL,
    last_seen_ts  INTEGER NOT NULL
  );
  CREATE TABLE hand_canonical (
    hand_key      TEXT PRIMARY KEY,
    player_id     TEXT NOT NULL REFERENCES casino_player(id) ON DELETE CASCADE,
    table_id      TEXT NOT NULL,
    hand_id       TEXT,
    hand_dedup_id TEXT NOT NULL,
    first_ts      INTEGER NOT NULL,
    last_ts       INTEGER NOT NULL,
    table_names_json TEXT,
    hero_seat     INTEGER NOT NULL,
    hero_hole_cards_json TEXT,
    frames_blob   BLOB NOT NULL,
    content_hash  TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    first_uploader_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    removed_at    INTEGER,
    removed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL
  );
  CREATE TABLE hand_upload (
    id             TEXT PRIMARY KEY,
    hand_key       TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
    user_id        TEXT REFERENCES user(id) ON DELETE SET NULL,
    uploaded_at    INTEGER NOT NULL,
    content_hash   TEXT NOT NULL,
    is_canonical   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE comment (
    id         TEXT PRIMARY KEY,
    hand_key   TEXT NOT NULL REFERENCES hand_canonical(hand_key) ON DELETE CASCADE,
    user_id    TEXT REFERENCES user(id) ON DELETE SET NULL,
    author_display TEXT,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    removed_at INTEGER
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta(key, value) VALUES ('schema_version', '2');
`);

// Seed one player + one v2 canonical row.
seed.prepare(`
  INSERT INTO casino_player (id, name, casino_user_id, first_seen_ts, last_seen_ts)
  VALUES (?, ?, ?, ?, ?)
`).run("p_alice", "Alice", 1001, 1, 2);
seed.prepare(`
  INSERT INTO hand_canonical
    (hand_key, player_id, table_id, hand_id, hand_dedup_id,
     first_ts, last_ts, table_names_json,
     hero_seat, hero_hole_cards_json,
     frames_blob, content_hash, created_at, first_uploader_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "p_alice::9001::h-1", "p_alice", "9001", "h-1", "h-1",
  1, 2, JSON.stringify(["Aquarium 2"]),
  5, JSON.stringify(["Ah", "Kd"]),
  Buffer.from("fake-gzip-bytes"), "hash1", 3, null
);
seed.close();

// Now boot the migration.
const { ensureMigrated } = await import("../src/lib/server/migrate.js");
const { getDb } = await import("../src/lib/server/db.js");
await ensureMigrated();
const db = await getDb();

let pass = true;
function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK " : "BAD"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) pass = false;
}

const meta = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
expect("schema_version flipped",          meta && meta.value,           "3");

const surviving = db.prepare("SELECT hand_key, hero_seat FROM hand_canonical WHERE hand_key=?").get("p_alice::9001::h-1");
expect("v2 row survived migration",        surviving && surviving.hand_key,  "p_alice::9001::h-1");
expect("v2 hero_seat preserved",           surviving && surviving.hero_seat, 5);

// And the post-migration table should accept a NULL hero_seat (would
// have thrown under v2).
let nullInsertOk = true;
try {
  db.prepare(`
    INSERT INTO casino_player (id, name, casino_user_id, first_seen_ts, last_seen_ts)
    VALUES (?, ?, ?, ?, ?)
  `).run("p_generic", "[Generic]", null, 1, 2);
  db.prepare(`
    INSERT INTO hand_canonical
      (hand_key, player_id, table_id, hand_id, hand_dedup_id,
       first_ts, last_ts, table_names_json,
       hero_seat, hero_hole_cards_json,
       frames_blob, content_hash, created_at, first_uploader_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
  `).run(
    "p_generic::9001::h-2", "p_generic", "9001", "h-2", "h-2",
    1, 2, null,
    Buffer.from("fake"), "hash2", 3, null
  );
} catch (e) {
  nullInsertOk = false;
  console.log("BAD  null hero insert threw:", e.message);
}
expect("null hero_seat insert accepted",   nullInsertOk,                    true);

if (existsSync(SMOKE_DB)) unlinkSync(SMOKE_DB);
process.exit(pass ? 0 : 1);
