// MySQL pool + thin async query helpers.
//
// Replaces the old better-sqlite3 setup (v3 and earlier). The driver is
// `mysql2/promise`; we keep one process-wide pool and hand out short-
// lived connections for transactional work via `tx()`.
//
// Helper API surface (keep these small — every callsite uses them):
//
//   query(sql, params?)      -> rows (array of plain objects).
//                               Same call as queryOne for SELECTs that
//                               return multiple rows.
//   queryOne(sql, params?)   -> first row (object) or undefined.
//                               Replaces better-sqlite3 `.get()`.
//   execute(sql, params?)    -> { affectedRows, insertId }.
//                               Replaces better-sqlite3 `.run()`.
//   tx(async fn)             -> wraps `fn(conn)` in BEGIN/COMMIT, with
//                               ROLLBACK on throw. The `conn` argument
//                               is a mysql2 PoolConnection; call
//                               `conn.query(sql, params)` / `conn.execute(...)`
//                               on it for the duration of the tx.
//
// Env access: SvelteKit provides `$env/dynamic/private` at runtime;
// `scripts/migrate.js` runs outside the framework, so we fall back to
// `process.env` if the SvelteKit module isn't resolvable.
//
// `getPool()` is the lazy singleton entry point. We don't expose the
// pool object directly to most callsites — they go through the
// helpers above so we can swap drivers later without rippling.

import mysql from "mysql2/promise";

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

let _pool = null;

async function buildPool() {
  const env = await getEnv();
  // Prefer DATABASE_URL when present; fall back to discrete vars so
  // local dev can put credentials on individual lines if preferred.
  const url = env.DATABASE_URL;
  const config = url
    ? { uri: url }
    : {
        host: env.MYSQL_HOST || "localhost",
        port: Number(env.MYSQL_PORT || 3306),
        user: env.MYSQL_USER || "root",
        password: env.MYSQL_PASSWORD || "",
        database: env.MYSQL_DATABASE || "statisticasino"
      };
  // `ssl: false` forces a plaintext connection. Aliyun RDS instances
  // ship with SSL DISABLED by default; opportunistic SSL would fail
  // the handshake. Flip to `{ rejectUnauthorized: true }` once you
  // enable SSL in the RDS console (Data Security -> SSL).
  const ssl = env.MYSQL_SSL === "1" ? {} : false;

  return mysql.createPool({
    ...config,
    ssl,
    waitForConnections: true,
    connectionLimit: Number(env.MYSQL_POOL_LIMIT || 10),
    // Keep a sensible default for the gzipped frame blobs; mysql2
    // splits large packets but the server has its own max_allowed_packet
    // (default 64 MB on RDS) which is plenty for our 50 MB upload cap.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // We always send millisecond timestamps as plain BIGINTs; tell mysql2
    // to surface them as JS numbers (safe because Number.MAX_SAFE_INTEGER
    // is around year 287000 in ms-since-epoch).
    supportBigNumbers: false,
    bigNumberStrings: false
  });
}

export async function getPool() {
  if (_pool) return _pool;
  _pool = await buildPool();
  return _pool;
}

// Run a SELECT (or any sql) against the pool. Returns the rows array.
// Rows are plain objects keyed by column name.
export async function query(sql, params = []) {
  const pool = await getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Same as query() but returns the first row (or undefined if no rows).
// Use this in place of better-sqlite3's `.get()`.
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

// Run an INSERT/UPDATE/DELETE. Returns { affectedRows, insertId } so
// callers don't need to know about the underlying ResultSetHeader shape.
export async function execute(sql, params = []) {
  const pool = await getPool();
  const [res] = await pool.execute(sql, params);
  return { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 };
}

// Transactional wrapper. The callback receives a PoolConnection
// (`conn`) — call `conn.query(sql, params)` / `conn.execute(sql, params)`
// for every statement that should be inside the transaction. Returns
// whatever the callback returns. Rolls back on throw.
//
//   await tx(async (conn) => {
//     const [rows] = await conn.query("SELECT ... FOR UPDATE", [k]);
//     await conn.execute("UPDATE ... WHERE ...", [...]);
//     return rows.length;
//   });
//
// We deliberately do NOT expose `pool.query`-style helpers on the conn
// object beyond what mysql2 already offers, so the surface stays small.
export async function tx(fn) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow rollback errors */ }
    throw err;
  } finally {
    conn.release();
  }
}

// Test-only / shutdown helper. Closes the pool so a fresh test run
// starts from scratch and process exit doesn't hang.
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
