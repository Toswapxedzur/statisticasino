# Statisticasino

Companion website to the `casinoMalwareExtension` Chrome extension.

> **Already deployed?** See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the
> production-specific runbook (Aliyun HK ECS + RDS Shenzhen + Cloudflare,
> incl. the mainland-China ICP trap that pushed us off cn-shenzhen).

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
  profile + (if admin) can perform privileged actions. The admin's
  email + password are **hardcoded** in `auth.js` and checked before
  the DB lookup at login (see "Auth model" below). The admin can
  promote ordinary users.

### Auth model (2026-05-22, schema v7)

- Signup requires an **email-verification code**. The form has four
  slots: display name (optional), email, password, and the 6-digit
  code that was emailed via Gmail SMTP (nodemailer talking to
  `smtp.gmail.com:465` with an app-scoped password). Once an account
  exists, no further verification is required on subsequent logins.
  Codes are stored as sha256 hashes with a 10-minute TTL. See
  `src/lib/server/email.js` and `email-verification.js`.
- The **admin account is hardcoded**
  (`auth.js#HARDCODED_ADMIN_EMAIL` + `HARDCODED_ADMIN_PASSWORD`).
  The DB carries only a shell row at id `admin-hardcoded` with a
  NULL `password_hash`, present so foreign-key references resolve;
  the auth check itself never touches the DB. Rotating the admin
  password means editing `auth.js` and redeploying.
- Signed-in users can **change their display name** from the
  `/account` page. The username is just a label; account identity is
  the email and is immutable post-signup.
- Only **admins** can upload via [`/contribute`](http://localhost:5273/contribute)
  or delete hands. Non-admins see a denial card on `/contribute` and
  the Data page hides every checkbox + Delete button.
- Deletes are **hard deletes** (`DELETE FROM hand_canonical`); the
  per-upload audit rows in `hand_upload` cascade away via the existing
  FK. There is no undelete — re-upload the original `.casinodump` if
  you want a round back. (Earlier revisions had a soft-delete with
  `removed_at` columns, but the dedup path didn't honour them, so
  re-uploads of a deleted round were silently dropped as duplicates.
  See `src/lib/server/migrate.js#migrateToV5` for the upgrade.)
- The Chrome extension's flush channel
  ([`/api/flush`](http://localhost:5273/api/flush)) is anonymous so
  the service worker can post without managing auth tokens. Posts are
  user-initiated (the extension does not auto-upload).

## Quick start (local-first)

Requirements: Node 20+ and a recent npm. macOS:

```bash
brew install node
```

Then:

```bash
cd statisticasino
cp .env.example .env       # fill in MYSQL_* and ADMIN_* values
npm install                # installs mysql2 (pure JS) + svelte
npm run migrate            # applies schema.sql to the configured DB
npm run dev                # http://localhost:5273
```

The database lives on a **MySQL 8** instance — locally that can be a
dockerised MySQL or any compatible server; in production we run on
Aliyun RDS for MySQL. Connection details come from `MYSQL_HOST`,
`MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` in
`.env`. See `.env.example` for the full list.

## How ingest + the data tree work (v2)

1. The Chrome extension's *Export* button produces a `.casinodump`
   (gzipped JSON + base64). Drop that on the [`/contribute`](http://localhost:5273/contribute) page.
   **Only admins can upload.** Pure spectator captures (no visible
   hole cards) are accepted only from admins, under a synthetic
   `[Generic]` player node.
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
| `/api/flush` | anyone | extension's user-initiated Flush now; always anonymous |
| `/data` listing | anyone | every row in `hand_canonical` is live (no soft-delete tombstones) |
| Per-round / table / player **delete** | admins only | hard delete; `hand_upload` audit rows cascade away. No undelete — re-upload the dump |
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

Refresh the [`/blog`](http://localhost:5273/blog) page; the post appears
within 60s (file watcher cache). Pinned posts sort above non-pinned ones;
within each bucket, newest first.

## File layout

```
statisticasino/
  package.json                  npm manifest
  svelte.config.js              SvelteKit config (node adapter)
  vite.config.js                Vite + dev port 5273
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
      db.js                     mysql2 pool + async query/queryOne/execute/tx helpers
      schema.sql                tables: user/session/hand_canonical/... (MySQL 8 / utf8mb4)
      migrate.js                apply schema.sql idempotently + auto-provision admin
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
MYSQL_HOST=rm-XXXX.mysql.cn-shenzhen.rds.aliyuncs.com \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=... \
MYSQL_DATABASE=statisticasino \
GMAIL_USER=you@gmail.com \
GMAIL_APP_PASSWORD='abcd efgh ijkl mnop' \
ORIGIN=https://stats.example.org \
node build
```

The admin's email + password are baked into `src/lib/server/auth.js`
(`HARDCODED_ADMIN_*`) — there is no env var for them. If `GMAIL_USER`
or `GMAIL_APP_PASSWORD` is unset, signup verification falls back to a
console-log stub so the flow is still testable on a fresh deploy.

The server listens on `PORT` (default 3000). Front it with caddy /
nginx / your favourite reverse proxy and terminate TLS there.

### Hosting requirements

This stack runs as a normal long-lived Node process talking to a
remote MySQL server. The constraints are mild:

| Requirement | Why | Hosts that work | Hosts that don't |
| - | - | - | - |
| Long-lived Node process | `node build` is a request-loop server, not a request-scoped lambda. | Aliyun ECS, DigitalOcean droplet, Render, Fly, Railway, Docker on anything | Cloudflare Workers, Vercel Edge Functions |
| Outbound TCP to MySQL | The app server connects out to RDS:3306. | Anything with outbound networking | Sandboxed function runtimes that block outbound TCP |
| Reverse proxy with TLS | Browsers + the extension's service worker only do HTTPS. | caddy, nginx, traefik | (none) |

For a school project, "a single Aliyun ECS instance in the same region
as RDS, behind caddy" is the minimum viable shape. Same-region keeps
DB latency in the single-digit milliseconds.

### Database hosting

We use **Aliyun RDS for MySQL 8** in production. RDS gives us:

- Daily snapshots + 7-day point-in-time recovery out of the box, so
  there's no need for a custom `mysqldump` cron.
- Storage that grows on demand; a school-project workload sits well
  under the 20 GB minimum tier.
- A public endpoint with optional IP whitelisting; the password is the
  only auth we use today (no IAM tie-in).

Notes:
- **TLS is OFF by default on Aliyun RDS** — the instance literally
  doesn't accept SSL handshakes until you enable it in the console
  (Data Security → SSL → "Enable SSL"). The app respects `MYSQL_SSL=1`
  in `.env` once you flip it; until then leave at `0`.
- **IP allow-list** lives in the RDS console too. Add your dev laptop
  and your production server's outbound IP. "All IPs" (`0.0.0.0/0`)
  works but is poor hygiene.
- **No IAM** in this setup — the password is the only credential.
  Rotate it from the RDS console if it ever leaks; remember to update
  `.env` afterwards.

### Environment variables

| Var | Default | Notes |
| - | - | - |
| `PORT` | `3000` | Bind port for the Node server. |
| `MYSQL_HOST` | (required) | RDS endpoint. |
| `MYSQL_PORT` | `3306` | |
| `MYSQL_USER` | (required) | RDS root or a dedicated app user. |
| `MYSQL_PASSWORD` | (required) | |
| `MYSQL_DATABASE` | `statisticasino` | Created automatically by `npm run migrate` if missing. |
| `MYSQL_SSL` | `0` | Set to `1` after enabling SSL in the RDS console. |
| `MYSQL_POOL_LIMIT` | `10` | Max simultaneous connections from the app. |
| `GMAIL_USER` | (none) | Full Gmail address used as the SMTP login + From: address. Empty -> stub mode (codes log to stdout). |
| `GMAIL_APP_PASSWORD` | (none) | 16-char app-scoped password from `https://myaccount.google.com/apppasswords`. NOT the regular Gmail password. Spaces are accepted and stripped. |
| `GMAIL_FROM_NAME` | `Statisticasino` | Display name shown in recipients' inboxes (the `@gmail.com` part is locked to GMAIL_USER). |
| `ORIGIN` | (none) | Public origin (`https://stats.example.org`) so SvelteKit knows what counts as same-origin. |

### CORS / CSRF on `/api/flush`

The extension fetches `FLUSH_ENDPOINT` from a `chrome-extension://...`
origin. SvelteKit's per-request CSRF guard would reject these, so
`svelte.config.js` sets `csrf.checkOrigin = false`. The endpoint is
anonymous-write by design (gzipped game capture in, JSON summary
out — no session cookies are read or written), so this is safe.

The endpoint is currently rate-limit-free. For a public release add a
cap at the proxy layer (e.g. nginx `limit_req`) before announcing the
URL anywhere — the in-app upload cap is 50 MB per request, which is
generous on purpose so the extension can flush large sessions in one
go.

## Local MySQL alternative

If you don't want every dev request to round-trip to Aliyun (latency,
flaky internet, etc.), spin up MySQL in Docker:

```bash
docker run --name statisticasino-mysql \
  -e MYSQL_ROOT_PASSWORD=local \
  -p 3306:3306 \
  -d mysql:8
```

then point `.env` at `localhost`:

```
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=local
MYSQL_DATABASE=statisticasino
MYSQL_SSL=0
```

`npm run migrate` works against either, since the schema is the same.
