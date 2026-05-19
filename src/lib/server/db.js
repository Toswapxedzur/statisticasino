// Single shared better-sqlite3 connection.
//
// We open the database lazily on first access so module import order
// doesn't matter. WAL mode for concurrent read while we write; foreign
// keys on so cascade deletes from `users` clean up sessions etc.
//
// Env access: SvelteKit provides `$env/dynamic/private` at runtime, but
// the standalone `scripts/migrate.js` runs outside the framework, so we
// fall back to `process.env` if the SvelteKit module isn't resolvable.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

let _env = null;
async function getEnv() {
  if (_env) return _env;
  try {
    const mod = await import("$env/dynamic/private");
    _env = mod.env;
  } catch {
    _env = process.env;
  }
  return _env;
}

let _db = null;

async function resolveDbPath() {
  const env = await getEnv();
  const raw = env.DATABASE_PATH || "../local_storage/casino.db";
  // Relative paths are resolved against the project root (CWD when
  // running `npm run dev` or `node scripts/migrate.js`), which is
  // `statisticasino/`. The default lands the DB in the sibling
  // `local_storage/` folder that the user created.
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export async function getDb() {
  if (_db) return _db;
  const path = await resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  _db = new Database(path);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

// Tx wrapper that uses better-sqlite3's `.transaction()` and rolls back
// on throw. Use for any multi-statement update that must be atomic
// (e.g. upload ingest). NOTE: the callback runs SYNCHRONOUSLY because
// better-sqlite3 transactions are synchronous; do all your DB work
// inside it without awaits.
export async function tx(fn) {
  const db = await getDb();
  return db.transaction(fn)();
}
