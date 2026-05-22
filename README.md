# Statisticasino

Companion website to the `casinoMalwareExtension` Chrome extension.
Aggregates poker hand captures uploaded by many users, merges them by
`(tableId, handId)`, and renders the result with the same look-and-feel
as the extension.

Three sections:

- **Data** — every table ever uploaded, drilled down into its rounds,
  with an inline replay that highlights *every* uploader's seat in red
  (0, 1, or N reds per hand depending on who has contributed).
- **Blog** — markdown files under `content/blog/`, rendered as
  investigation write-ups.
- **Account** — anonymous browsing is allowed; signed-in users have a
  profile + (if admin) can perform privileged actions. One admin (the
  first account matching `ADMIN_EMAIL`) can promote others.

### Auth model (2026-05-20)

- Only **admins** can upload via [`/upload`](http://localhost:5173/upload)
  or delete hands. Non-admins see a denial card on `/upload` and the
  Data page hides every checkbox + Delete button.
- Deletes are **soft-deletes**: `hand_canonical.removed_at` /
  `removed_by_user_id` get stamped, and every read path filters
  `WHERE removed_at IS NULL`. Reversible by clearing those columns in
  SQL if you ever want a hand back.
- The Chrome extension's autoflush channel
  ([`/api/flush`](http://localhost:5173/api/flush)) remains anonymous
  so the extension's background service worker can keep posting
  without managing auth tokens.

## Quick start (local-first)

Requirements: Node 20+ and a recent npm. macOS:

```bash
brew install node
```

Then:

```bash
cd statisticasino
cp .env.example .env       # adjust if you want
npm install                # installs better-sqlite3 (native build) + svelte
npm run migrate            # creates ../local_storage/casino.db
npm run dev                # http://localhost:5173
```

The DB file lives at `../local_storage/casino.db` by default — same
parent folder as the Chrome extension's source tree. Override via
`DATABASE_PATH` in `.env`.

## How ingest + the data tree work (v2)

1. The Chrome extension's *Export all* button produces a `.casinodump`
   (gzipped JSON + base64). Drop that on the [`/upload`](http://localhost:5173/upload) page.
   **Anyone can upload** (signed-in or anonymous). Pure spectator
   captures (no visible hole cards) are rejected as *generic*.
2. For each hand envelope the server detects the **single perspective
   owner** — the seat whose hole cards are real (not `["X","X"]`) in
   the first `dealHoleCards`. The seat's `userId` is resolved against
   the container's `userIndex` to a casino-side display name.
3. `(playerName, tableId, handId)` is the dedup key on
   `hand_canonical`. Re-uploads from the **same** in-game player at
   the same round collapse to one row (first bytes win); the **same**
   round captured by a **different** in-game player produces a
   separate row under that other player.
4. The `/data` tree is three levels deep:

       Player (casino-side screen name)
       ├── Table (with all the names it's been called by)
       │   └── Round n
       └── ...

   The "player" node is the in-game perspective owner — **not** the
   uploader's site account. Two different casino-side players at the
   same physical table get two sibling player nodes.
5. Each round's replay highlights **exactly one** red seat: the
   perspective-owner seat for that row.

### Auth model

| surface | who | notes |
| - | - | - |
| `/upload` | anyone | rejects generic (no-perspective) dumps |
| `/api/flush` | anyone | extension's autoflush; always anonymous |
| `/data` listing | anyone | reads always filter `removed_at IS NULL` |
| Per-round / table / player **delete** | admins only | soft-delete; `hand_canonical.removed_at` + `removed_by_user_id` keep the audit trail |
| Comments (placeholder) | TBD | schema supports anonymous comments |

### v1 → v2 migration

The schema went from a single canonical row per `(tableId, handId)`
with a multi-hero `hand_perspective` union table to per-player rows
with a single `hero_seat`. Per the user's choice, the migration
**drops** the old `hand_canonical` / `hand_perspective` / `hand_upload`
tables on first boot (accounts + sessions + comments are preserved).

## Adding a blog post

```bash
cat > content/blog/my-post.md <<'EOF'
---
title: "Some investigation"
date: 2026-06-01
description: "What I found."
pinned: false       # set to true to float above other posts
draft: false        # set to true to hide from non-admins
---

Markdown body here.
EOF
```

Refresh the [`/blog`](http://localhost:5173/blog) page; the post appears
within 60s (file watcher cache). Pinned posts sort above non-pinned ones;
within each bucket, newest first.

## File layout

```
statisticasino/
  package.json                  npm manifest
  svelte.config.js              SvelteKit config (node adapter)
  vite.config.js                Vite (external better-sqlite3)
  .env.example                  template; copy to .env
  scripts/migrate.js            standalone schema applier
  content/blog/*.md             blog source-of-truth
  static/replay-engine/         copied from the extension:
    tableize.js cards.js users.js replay.js   (engine modules)
    replay-felt.css                            (felt + replay styles)
    assets/                                    (card faces + chips)
  src/
    app.css                     site palette + chrome (mirrors extension)
    app.html                    document shell
    hooks.server.js             session hydration + auto-migrate
    routes/
      +layout.svelte            topbar + nav
      +page.svelte              landing card
      data/                     Data tab
      blog/                     Blog tab
      upload/                   .casinodump ingest form
      account/                  Sign in / sign up / profile / admin
    lib/server/
      db.js                     shared better-sqlite3 connection
      schema.sql                tables: user/session/hand_canonical/...
      migrate.js                apply schema.sql idempotently
      auth.js                   scrypt + session tokens + admin promotion
      cookies.js                cookie helpers (session name + serialiser)
      ingest.js                 .casinodump -> hand_canonical merge
      perspective.js            detect which seat an upload "saw" from
      tables.js                 read helpers for Data page
      blog.js                   filesystem + gray-matter + marked
```

## Production

`npm run build` produces a Node server in `build/`. Run:

```bash
DATABASE_PATH=/var/lib/casino/casino.db \
ADMIN_EMAIL=you@example.com \
node build
```

The server listens on `PORT` (default 3000). Front it with caddy /
nginx / your favourite reverse proxy.

### Hosting requirements

This stack has a few non-negotiables that ruled some hosts out:

| Requirement | Why | Hosts that work | Hosts that don't |
| - | - | - | - |
| Native Node addons (`better-sqlite3`) | The DB driver is a compiled C++ binding; no V8-only / edge runtimes. | Fly.io, Render, Railway, a plain VPS, Docker on anything | Cloudflare Workers, Vercel Edge Functions, Deno Deploy |
| Persistent disk | `casino.db` is one file. If the disk vanishes between deploys, every uploaded hand is gone. | Anything with attached block / volume storage | Vercel serverless, "ephemeral container" tiers |
| Long-lived process | `npm run dev` and `node build` are normal long-lived servers, not request-scoped lambdas. | Same as above | Lambda / serverless without a "background worker" tier |
| Outbound HTTPS to nothing in particular | The server **doesn't** call out to anything; only the extension calls in. | All | (none) |

Concretely, "a small VPS with a 5 GB attached volume mounted at
`/var/lib/casino`" is the minimum viable shape. Render or Fly with a
persistent disk both work and have free tiers that are big enough for
a school project.

### Volume layout

```
/var/lib/casino/
  casino.db          SQLite file (DATABASE_PATH points here)
  casino.db-wal      auto-managed by sqlite (WAL mode)
  casino.db-shm      auto-managed by sqlite
  backups/           if you wire up the backup script below
```

Make sure the Node process has read+write on the directory, not just
on `casino.db` — SQLite needs to (re)create the `-wal` / `-shm`
sidecar files.

### Backups

There is no built-in backup job. For a school-project scale (≤100 MB
DB, ≤handful of contributors per day), the simplest thing is a cron
that runs `sqlite3 casino.db ".backup backups/casino-YYYYMMDD.db"`
nightly and ages out files older than ~14 days. SQLite's `.backup`
command is online — it does not lock writers — so you can run it
against the live DB.

If your host (Fly, Render, etc.) offers volume snapshots, just enable
those and skip the cron — same effect.

### Environment variables

| Var | Default | Notes |
| - | - | - |
| `PORT` | `3000` | Bind port for the Node server. |
| `DATABASE_PATH` | `../local_storage/casino.db` | Absolute path strongly recommended in production. |
| `ADMIN_EMAIL` | (none) | The first account whose email matches becomes the admin. |
| `ORIGIN` | (none) | Set to your public origin (e.g. `https://stats.example.org`) so SvelteKit's CSRF check passes for `POST` from the same domain. |

### CORS on `/api/flush`

The extension fetches `FLUSH_ENDPOINT` from a `chrome-extension://...`
origin. If your reverse proxy is strict about CORS, add the extension
origin to the allow-list, **or** keep it permissive on `/api/flush`
specifically since that endpoint is anonymous-write by design.

The endpoint is currently rate-limit-free. For a public release add a
cap at the proxy layer (e.g. nginx `limit_req`) before announcing the
URL anywhere — the body cap in the app is generous on purpose so the
extension can flush large sessions in one go.

## Migrating to Postgres later

The SQL in `src/lib/server/schema.sql` is intentionally vanilla. To
move to Postgres:

1. Replace `better-sqlite3` with `pg` in `db.js`.
2. Change the BLOB column to `bytea`.
3. Adjust the `ON CONFLICT` syntax (already Postgres-compatible).
4. Repoint `DATABASE_PATH` to a connection string.

No application code needs to change; the queries are all plain SQL.
