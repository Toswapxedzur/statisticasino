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
- **Account** — anonymous browsing + uploading is allowed; signed-in
  users have a profile + can perform privileged actions. One admin
  (the first account matching `ADMIN_EMAIL`) can promote others.

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

## How the merge works

1. The Chrome extension's *Export all* button produces a `.casinodump`
   (gzipped JSON + base64). Drop that on the [`/upload`](http://localhost:5173/upload) page.
2. The site decodes the container and walks each hand envelope.
3. For each `(tableId, handId)` it looks up `hand_canonical`:
   - **first upload wins**: the canonical frames are immutable once
     written. Subsequent uploads of the same hand contribute only the
     uploader's perspective (their seat + their hole cards).
4. `hand_perspective` is the materialised set of perspective owners per
   hand. The replay panel renders one red seat per row in that table.

When an admin or authenticated user (eventually) cleans data, removing
all contributions from a particular uploader can leave a hand with
**zero** perspectives — the merged view then has no red seats. That's
intentional.

## Adding a blog post

```bash
cat > content/blog/my-post.md <<'EOF'
---
title: "Some investigation"
date: 2026-06-01
description: "What I found."
---

Markdown body here.
EOF
```

Refresh the [`/blog`](http://localhost:5173/blog) page; the post appears
within 60s (file watcher cache).

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

## Migrating to Postgres later

The SQL in `src/lib/server/schema.sql` is intentionally vanilla. To
move to Postgres:

1. Replace `better-sqlite3` with `pg` in `db.js`.
2. Change the BLOB column to `bytea`.
3. Adjust the `ON CONFLICT` syntax (already Postgres-compatible).
4. Repoint `DATABASE_PATH` to a connection string.

No application code needs to change; the queries are all plain SQL.
