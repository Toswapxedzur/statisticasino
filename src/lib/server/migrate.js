// One-shot migration runner.
//
// Idempotent: schema.sql is all `CREATE TABLE IF NOT EXISTS` and
// `INSERT OR IGNORE`, so calling at every boot is safe and cheap.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _migrated = false;

export async function ensureMigrated() {
  if (_migrated) return;
  const sql = readFileSync(resolve(__dirname, "schema.sql"), "utf8");
  const db = await getDb();
  db.exec(sql);
  _migrated = true;
}
