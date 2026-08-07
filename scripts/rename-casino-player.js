// Manual `casino_user_id -> username` rename / merge tool (2026-05-28).
//
// Background:
//   `resolvePerspectivePlayer` (src/lib/server/perspective.js) falls back
//   to `"User <userId>"` when the extension's flush-time `userIndex`
//   doesn't carry a real username for the perspective seat — typically
//   because the user opened a table directly without visiting the
//   lobby, OR because the lobby snapshot rotated out of the 2000-entry
//   `messages[]` rolling buffer before the next flush.
//
//   When this happens AFTER the same user had been resolved correctly
//   in an earlier session, the DB ends up with TWO casino_player rows
//   for the same casino_user_id: one named "RealName", one named
//   "User <N>". They share casino_user_id but ingest's parent lookup
//   keys on `name`, so it never reconciles them.
//
// This script takes a list of `{ casinoUserId, username }` pairs and,
// for each, reparents every hand owned by any other casino_player row
// with the same `casino_user_id` onto the row whose `name` matches the
// supplied username (creating that row if missing). The orphans are
// then dropped.
//
// Idempotent. Dry-run by default; pass `--apply` to write the changes.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apply = process.argv.includes("--apply");

// Hard-coded mapping for one-off rename runs. Edit this list when you
// want to add a new manual mapping; re-running the script is a no-op
// for entries that have already been merged.
const MAPPINGS = [
  { casinoUserId: 4558098, username: "HatWholebuyer" }
];

const { tx, closePool } = await import("../src/lib/server/db.js");

const summary = { mappings: 0, kept: [], orphaned: [], reparented: 0, created: 0 };

await tx(async (conn) => {
  for (const m of MAPPINGS) {
    summary.mappings++;
    const uid = Number(m.casinoUserId);
    const name = String(m.username);

    // Pull every row that shares the casino_user_id, plus any row that
    // already has the target name (in case it was created with no
    // casino_user_id and is keyed only on name).
    const [rows] = await conn.query(
      "SELECT id, name, casino_user_id, first_seen_ts, last_seen_ts "
    + "  FROM casino_player "
    + " WHERE casino_user_id = ? OR name = ? "
    + " ORDER BY (name = ?) DESC, first_seen_ts ASC",
      [uid, name, name]
    );

    let keeper = rows.find((r) => r.name === name);

    if (!keeper && rows.length === 0) {
      // No row to work with at all — create one so future renames can
      // reparent onto it. Generate a random hex id (mirrors ingest.js#newId).
      const { randomBytes } = await import("node:crypto");
      const newId = randomBytes(16).toString("hex");
      const ts = Date.now();
      if (apply) {
        await conn.query(
          "INSERT INTO casino_player (id, name, casino_user_id, first_seen_ts, last_seen_ts) "
        + "VALUES (?, ?, ?, ?, ?)",
          [newId, name, uid, ts, ts]
        );
      }
      summary.created++;
      console.log(`[rename] uid=${uid} -> created keeper row name='${name}' id=${newId}`);
      continue;
    }

    if (!keeper) {
      // No row named `name` exists, but there ARE rows for this
      // casino_user_id. Promote the oldest one in-place.
      keeper = rows[0];
      if (apply) {
        await conn.query(
          "UPDATE casino_player SET name = ? WHERE id = ?",
          [name, keeper.id]
        );
      }
      keeper.name = name;
      console.log(`[rename] uid=${uid} -> promoting row ${keeper.id} to name='${name}'`);
    }

    summary.kept.push({ id: keeper.id, name: keeper.name });

    // Re-parent + delete every other row sharing this casino_user_id.
    const orphans = rows.filter((r) => r.id !== keeper.id && r.casino_user_id === uid);
    for (const orphan of orphans) {
      const [handCountRows] = await conn.query(
        "SELECT COUNT(*) AS n FROM hand_canonical WHERE player_id = ?",
        [orphan.id]
      );
      const handCount = handCountRows[0]?.n || 0;
      if (apply) {
        if (handCount > 0) {
          await conn.query(
            "UPDATE hand_canonical SET player_id = ? WHERE player_id = ?",
            [keeper.id, orphan.id]
          );
        }
        await conn.query(
          "UPDATE casino_player "
        + "   SET first_seen_ts = LEAST(first_seen_ts, ?), "
        + "       last_seen_ts  = GREATEST(last_seen_ts, ?), "
        + "       casino_user_id = COALESCE(casino_user_id, ?) "
        + " WHERE id = ?",
          [orphan.first_seen_ts, orphan.last_seen_ts, uid, keeper.id]
        );
        await conn.query(
          "DELETE FROM casino_player WHERE id = ?",
          [orphan.id]
        );
      }
      summary.orphaned.push({ id: orphan.id, name: orphan.name, hands: handCount });
      summary.reparented += handCount;
      console.log(
        `[rename] uid=${uid} -> orphan ${orphan.id} (name='${orphan.name}', ${handCount} hands) `
      + `${apply ? "reparented + deleted" : "(dry run)"}`
      );
    }
  }
});

console.log("---");
console.log(JSON.stringify(summary, null, 2));

if (!apply) {
  console.log("[rename] dry run; pass --apply to write changes.");
}

await closePool();
