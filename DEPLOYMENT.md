# Deployment runbook

How **Bluffing Valley** (repo dir `statisticasino/`) actually runs in production
today, and the steps to get it back up from a blank Linux box. The generic
"Production" section in [`README.md`](./README.md#production) covers the
framework-level recipe; this file is the concrete, "what we shipped", warts-and-all
record.

> **Naming (renamed 2026-09-05: Riverside → Bluffing Valley).** Live host
> `bluffingvalley.blopybox.net` (any old host 301-redirects). App dir
> `/opt/bluffing-valley`, systemd unit `bluffing-valley.service`, log identifier
> `[bluffing-valley]`. **Unchanged on purpose:** OSS bucket `riverside-media`
> (buckets can't be renamed), MySQL user `riverside`, and the mini2 archive names
> (`~/riverside-archive`, `com.johnzhu.riverside-archive-*`). The repo folder is
> still `statisticasino/` and the code package name is unchanged.

> ⚠️ **VPS LIFETIME — the box is a rented Aliyun SWAS instance that EXPIRES
> `2026-09-20T16:00Z`, auto-renew OFF. OWNER DECISION 2026-09-15: LET IT LAPSE.**
> The site, voice/coturn, and the replay-archive tunnel go dark on the 20th; no
> renew, no migrate. Data survival then rests entirely on the nightly DB backup
> mirrored to mini2 (§ Database backups) — confirm mini2 is awake and its mirror is
> current before the 20th (mini2 was offline on 2026-09-15, so this was unverified).
> §2 below stays the accurate migration runbook if that decision changes.

If you're picking this up cold, read **§1 (architecture)** first, and **§5
(mainland-China ICP history)** if you ever consider a mainland-China origin again.

---

## 1. Architecture (current, verified 2026-09-15)

```
   Browser            Cloudflare            Aliyun HK SWAS box                 local MySQL
 ┌──────────┐        ┌──────────┐        ┌──────────────────────────┐       ┌──────────────┐
 │ user     │ HTTPS  │ DNS-only │  HTTP  │ Caddy :80/:443 (per-host)│  TCP  │ MySQL 8      │
 │ /        ├───────►│ grey     ├───────►│  ↳ reverse_proxy         ├──────►│ 127.0.0.1    │
 │ /api/... │        │ cloud    │        │     127.0.0.1:3000       │       │ :3306        │
 │ /ws      │        │ (ACME    │        │ node /opt/bluffing-      │       │ db           │
 │ /data    │        │  reaches │        │   valley/server.js       │       │ statisticasino│
 └──────────┘        │  origin) │        │ (systemd, HTTP + poker WS)│      └──────────────┘
                     └──────────┘        └──────────────────────────┘
                            ▲                        ▲
                            │                        │
                  bluffingvalley.blopybox.net   47.243.163.51  (ssh hk)
```

- **Origin**: Aliyun HK **SWAS** (Simple Application Server, **not** classic ECS —
  `DescribeInstances` in `cn-hongkong` is empty), Ubuntu 24.04, public IP
  `47.243.163.51`, private NIC `172.19.52.134` (1:1 NAT). InstanceId
  `c91a2e4803b74799aa1a0ad774194e77`. SSH via `~/.ssh/config` host **`hk`**
  (user `admin`, passwordless sudo, key `~/.ssh/aliyun_hk_ed25519`). Provisioned
  outside mainland China to sidestep ICP filing — see §5.
- **Reverse proxy**: **Caddy** (v2.11.x) on `:80`/`:443`, config
  `/etc/caddy/Caddyfile`. Caddy terminates TLS itself (auto Let's Encrypt) and
  proxies WebSockets natively — no per-location upgrade config needed. The site
  block is just:
  ```
  bluffingvalley.blopybox.net {
      reverse_proxy 127.0.0.1:3000
  }
  ```
  **Never `systemctl restart caddy`** (it would drop the co-located Netbird/other
  sites' certs mid-issue) — use `sudo systemctl reload caddy`.
- **App**: SvelteKit (adapter-node) started via `node /opt/bluffing-valley/server.js`
  (**not** `node build` — see §2.5.1), managed by systemd unit
  `bluffing-valley.service`, listens on `127.0.0.1:3000`. `server.js` serves the
  normal HTTP handler **and** the poker WebSocket gateway (`/ws`) on the same port.
- **Database**: **LOCAL MySQL 8 on the box** (`127.0.0.1:3306`, db `statisticasino`,
  user `riverside`). Chosen over the old Aliyun RDS. Password is generated on the
  box, lives only in `/opt/bluffing-valley/.env` (chmod 600), never in the repo or
  chat. Migrations auto-run on boot (`hooks.server.js#ensureMigrated`, idempotent).
- **Shared box**: also runs **Netbird** (Docker; owns udp/3478), **coturn** (voice,
  udp/3479 — §Voice), and an `adamancia-vault` stack. Deploys are purely additive
  (one Caddy block, one DNS record). Don't touch the other services.
- **DNS**: Cloudflare (zone `blopybox.net`), `bluffingvalley` A → `47.243.163.51`,
  **DNS-only (grey cloud)** — required so Caddy's ACME HTTP-01 challenge reaches the
  origin, and matching Netbird's requirement on this box.

---

## 2. From-scratch deploy (to a NEW box)

Use this only when migrating to a fresh box (e.g. after the VPS expires). All
commands run on a developer laptop unless they're in an `ssh '…'` block. `<box>` is
the new host's SSH alias.

### 2.1 Pre-flight

- A Linux box with `apt` + systemd (Ubuntu 24.04 is what we run). Caddy handles
  TLS, so you need inbound **TCP 80 + 443** (ACME + serving) and **TCP 22** (SSH),
  plus **UDP 3479 + 49152–49200** if you also want voice (§Voice).
- SSH config entry for the box (user, key). Passwordless sudo is convenient.
- A Cloudflare DNS-only A record for the hostname → the box IP.

### 2.2 Install runtime

```bash
ssh <box> 'sudo apt-get update && sudo apt-get -y install nodejs npm mysql-server rsync curl
  # Caddy: install from the official apt repo (https://caddyserver.com/docs/install)
  node --version   # expect v20+
  sudo mkdir -p /opt/bluffing-valley && sudo chown $USER /opt/bluffing-valley
'
```

Ubuntu 24.04's default `nodejs` may be old; if so use NodeSource to pin v20+.
Secure the local MySQL and create the app DB + user:

```bash
ssh <box> 'sudo mysql <<SQL
  CREATE DATABASE IF NOT EXISTS statisticasino CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS "riverside"@"localhost" IDENTIFIED BY "__generate_me__";
  GRANT ALL PRIVILEGES ON statisticasino.* TO "riverside"@"localhost";
  FLUSH PRIVILEGES;
SQL'
```

### 2.3 Build locally and ship

```bash
cd statisticasino
npm install
npm run build      # produces build/ via @sveltejs/adapter-node
                   # also rebuilds static/downloads/casino-inspector.zip

rsync -az --delete \
  --exclude=node_modules/ --exclude=.svelte-kit/ --exclude=.git/ \
  --exclude=.venv/ --exclude=.idea/ --exclude=.DS_Store --exclude='smoke-*.sqlite*' \
  --exclude=.env --exclude=.env.prod.bak \
  ./ <box>:/opt/bluffing-valley/
```

We ship `build/` from local instead of building on the box (Vite's build is
heavier than a small VPS wants). We exclude `.env`/`.env.prod.bak` so secrets only
live on the box.

**The rsync above already ships `server.js` and `src/`, and both are required at
runtime.** `server.js` (the prod entrypoint, §2.5.1) mounts `build/handler.js` for
HTTP and dynamically imports the plain-node poker modules under
`src/lib/server/poker/` plus `src/lib/poker/protocol.js` for the WebSocket layer.
Do **not** add `src/` to the rsync excludes.

### 2.4 Configure secrets and install runtime deps

Write `/opt/bluffing-valley/.env` directly on the box (do **not** rsync it from
your laptop's working tree). Point at **local** MySQL:

```bash
ssh <box> 'cat > /opt/bluffing-valley/.env <<EOF
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=riverside
MYSQL_PASSWORD=__the_generated_password__
MYSQL_DATABASE=statisticasino
MYSQL_SSL=0

# Gmail SMTP. Leave empty for stub mode (verification codes print to
# journalctl instead of being mailed). See §7 for setup.
GMAIL_USER=
GMAIL_APP_PASSWORD=
GMAIL_FROM_NAME=Bluffing Valley

# Voice (optional — see §Voice): coturn on this box
# TURN_URL=turn:47.243.163.51:3479?transport=udp
# TURN_SECRET=__coturn_static_auth_secret__
# TURN_TTL=3600

# Media (optional — Aliyun OSS): OSS_ACCESS_KEY_ID / _SECRET / _BUCKET / _ENDPOINT
# Replay archive (optional — mini2): REPLAY_ARCHIVE_URL=http://127.0.0.1:8790

PORT=3000
HOST=127.0.0.1
ORIGIN=https://bluffingvalley.blopybox.net
EOF
chmod 600 /opt/bluffing-valley/.env

cd /opt/bluffing-valley
npm ci --omit=dev --no-audit --no-fund
'
```

`server.js` auto-runs migrations on boot (`ensureMigrated` → `schema.sql`
idempotent `CREATE TABLE IF NOT EXISTS …` + column ALTERs), so you normally do not
invoke `scripts/migrate.js` by hand. Signup grants 10k chips; with `GMAIL_*` unset,
email codes are stubbed to the journal so signup completes without a real code.

The admin account is a hardcoded shell row — its **password lives in
`src/lib/server/auth.js` (`HARDCODED_ADMIN_*`)**, not in `.env`.

### 2.5 systemd unit

`/etc/systemd/system/bluffing-valley.service`:

```ini
[Unit]
Description=Bluffing Valley (SvelteKit adapter-node + poker WS)
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=admin
WorkingDirectory=/opt/bluffing-valley
Environment=NODE_ENV=production
# server.js parses /opt/bluffing-valley/.env itself (no EnvironmentFile needed).
# Entrypoint is server.js, NOT `node build` — see §2.5.1. WorkingDirectory must be
# /opt/bluffing-valley so server.js resolves ./build and ./src.
ExecStart=/usr/bin/node /opt/bluffing-valley/server.js
Restart=always
RestartSec=2
# server.js installs a SIGTERM/SIGINT handler that drains poker tables (refunds
# seated chips to wallets) and closes the HTTP+WS server, with a 3s hard-exit
# fallback. TimeoutStopSec stays a safety net above that.
TimeoutStopSec=10
KillSignal=SIGTERM
KillMode=mixed
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bluffing-valley

[Install]
WantedBy=multi-user.target
```

```bash
ssh <box> '
  sudo systemctl daemon-reload
  sudo systemctl enable --now bluffing-valley
  systemctl is-active bluffing-valley                                   # active
  sudo ss -tlnp | grep 3000                                            # node on 127.0.0.1:3000
  curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/     # 200
  journalctl -u bluffing-valley -n 5 | grep bluffing-valley            # "[bluffing-valley] http + ws listening ..."
'
```

### 2.5.1 Prod entrypoint: `server.js` (not `node build`)

The poker room needs a WebSocket server. adapter-node's `build/handler.js` is a
bare HTTP request handler — `node build` can only serve HTTP, so it cannot also
accept WS upgrades. `server.js` creates the `http.Server` ourselves, mounts the
SvelteKit handler for normal requests, and attaches the poker gateway for `/ws`
upgrades on the **same** port. `npm start` runs exactly this
(`"start": "node server.js"`); systemd's `ExecStart` (§2.5) points at it directly.

Consequences for deploys:

- **Ship `src/` too.** `server.js` dynamically imports the plain-node poker modules
  from `src/lib/server/poker/` — the §2.3 rsync already includes them; just don't
  exclude `src/`.
- **Caddy needs no change.** Caddy proxies WebSockets transparently, so `/ws` rides
  the same `reverse_proxy` block. Cloudflare (grey cloud) passes WS through too.
- **Chips survive restarts AND crashes (crash-safe escrow).** A buy-in debits the
  wallet, and the on-table stack is mirrored to the durable `poker_escrow` table IN
  THE SAME transaction (see `src/lib/server/poker/bank.js`), so `wallet + escrow` is
  conserved at every committed DB state. On `SIGTERM`/`SIGINT` (every
  `systemctl restart`) `hub.shutdown()` drains seats back to wallets. On a HARD
  crash (`SIGKILL`/OOM/power loss) the drain is skipped, but on next boot
  `reconcileEscrowOnBoot()` (server.js, before `listen`) refunds every escrow row to
  its wallet and closes stale ephemeral tables. Either way, no chips are destroyed.
- **Exactly-once money ops (idempotency keys).** Buy-in and rebuy carry a unique
  `chip_ledger.op_key` (v13, `UNIQUE`). If a COMMIT acknowledgement is lost, the
  operation is resolved by looking the key up: committed ⇒ return the durable
  result, never re-apply. Cash-out is escrow-authoritative and gated on the escrow
  row, so a retried Stand credits 0 rather than paying twice.
- **Single-instance lease — safe against a second live process.** On boot the
  server takes a process-lifetime `GET_LOCK('riverside_poker_singleton')` on a held
  connection (`acquireInstanceLease`). It reconciles escrow and attaches the poker
  gateway ONLY if it holds the lease; a second process on the same DB logs
  "serving HTTP only (poker disabled)" and never touches the other's live escrow.
  The lease is released on `SIGTERM`/`SIGINT`. **A 4-minute `SELECT 1` keepalive**
  on the lease connection (`LEASE_KEEPALIVE_MS`) stops MySQL's idle `wait_timeout`
  from silently dropping the lock — this fixed the old "~8h restart" bug (§ known
  issues). If the lease connection genuinely dies, the server fail-stops
  (`process.exit(1)`) and systemd restarts it, so there's never split-brain.
- **Dev never touches prod.** `npm run dev` refuses to reconcile escrow unless the
  effective DB host is loopback; and since the box's MySQL is local anyway, keep
  local dev on a separate local MySQL / db (see the top-level `casin-prod-db-safety`
  memory) — never point `.env` back at any remote prod DB.

To sanity-check the WS path end to end after `systemctl restart`, from the box:
`curl -sS -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Key: x' -H 'Sec-WebSocket-Version: 13' http://127.0.0.1:3000/ws`
should return `101`.

### 2.6 Caddy

Add one block to `/etc/caddy/Caddyfile` (the box already has other sites' blocks —
append, don't replace):

```
bluffingvalley.blopybox.net {
    reverse_proxy 127.0.0.1:3000
}
```

Then `sudo systemctl reload caddy` (**reload, never restart** — restart drops the
co-located Netbird / other sites mid-cert). Caddy auto-issues and renews the Let's
Encrypt cert (needs the DNS-only A record from §2.7 so the ACME challenge reaches
origin) and proxies WS natively. The old nginx + Cloudflare-real-IP + manual TLS
setup is gone.

### 2.7 DNS (Cloudflare)

Cloudflare → zone `blopybox.net` → DNS → Records:

- `A bluffingvalley 47.243.163.51` **DNS only (grey cloud)** — grey is required so
  Caddy's ACME HTTP-01 challenge reaches the origin and to match Netbird on this box.

### 2.8 Smoke test

```bash
# DNS
dig +short bluffingvalley.blopybox.net          # 47.243.163.51
# HTTPS (Caddy-issued cert)
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://bluffingvalley.blopybox.net/   # 200
# WS upgrade through the public edge
curl -sS -o /dev/null -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: x' -H 'Sec-WebSocket-Version: 13' \
  https://bluffingvalley.blopybox.net/ws       # 101
# /api/flush wired up (400 with JSON body == ok, 5xx == bad)
curl -sS -X POST -H 'Content-Type: application/json' --data '{"_probe":true}' \
  https://bluffingvalley.blopybox.net/api/flush
```

---

## 3. Day-2 operations

### 3.1 Redeploy after a code change

From the repo on the laptop:

```bash
cd statisticasino
npm run build
rsync -az --delete \
  --exclude=node_modules/ --exclude=.svelte-kit/ --exclude=.git/ \
  --exclude=.venv/ --exclude=.idea/ --exclude=.DS_Store --exclude='smoke-*.sqlite*' \
  --exclude=.env --exclude=.env.prod.bak \
  -e ssh ./ hk:/opt/bluffing-valley/
ssh hk 'cd /opt/bluffing-valley && npm ci --omit=dev && sudo systemctl restart bluffing-valley'
```

Dry-run with `--dry-run --itemize-changes` first; `--delete` is safe because the
excludes protect `node_modules`/`.env`/`.venv` (box-only). Migrations are idempotent
and run at every boot via `hooks.server.js#ensureMigrated`, so you rarely invoke
`migrate.js` by hand. Verify: `curl https://bluffingvalley.blopybox.net/` = 200.

### 3.2 Inspecting

```bash
ssh hk

# App
systemctl status bluffing-valley
journalctl -u bluffing-valley -f               # live tail
journalctl -u bluffing-valley --since '5min ago'

# Reverse proxy (Caddy)
sudo caddy validate --config /etc/caddy/Caddyfile
journalctl -u caddy -f

# Listening ports
sudo ss -tlnp
```

### 3.3 Restarts

```bash
sudo systemctl restart bluffing-valley   # ~1s thanks to TimeoutStopSec=10
sudo systemctl reload caddy              # zero-downtime; NEVER `restart caddy`
```

### 3.4 Rotating secrets

`MYSQL_PASSWORD` rotation (local MySQL now, not RDS):

1. `ssh hk 'sudo mysql -e "ALTER USER \"riverside\"@\"localhost\" IDENTIFIED BY \"NEW\";"'`
2. `ssh hk 'sudo sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=NEW|" /opt/bluffing-valley/.env && sudo systemctl restart bluffing-valley'`
3. `ssh hk 'journalctl -u bluffing-valley -n 50 --no-pager'` — first DB-touching
   request should succeed.

Admin password rotation: edit `src/lib/server/auth.js#HARDCODED_ADMIN_*`, `npm run
build` locally, rsync `build/` + `src/` to the box, `sudo systemctl restart
bluffing-valley`. There is no env-driven admin secret.

`GMAIL_APP_PASSWORD` rotation: revoke at <https://myaccount.google.com/apppasswords>,
generate a new one, edit `.env`, `sudo systemctl restart bluffing-valley`. The next
signup sends under the new password; in-flight verification rows survive.

---

## 4. File / config reference

| Path on origin | Owner | Purpose |
| - | - | - |
| `/opt/bluffing-valley/` | admin | App code (rsynced from local) |
| `/opt/bluffing-valley/.env` | admin, `0600` | Prod secrets (local DB, ORIGIN, OSS, TURN, archive). server.js self-parses it. |
| `/opt/bluffing-valley/server.js` | admin | Prod entrypoint — HTTP + poker WS (`ExecStart` runs this, §2.5.1) |
| `/opt/bluffing-valley/build/` | admin | adapter-node output (`server.js` mounts `build/handler.js`) |
| `/opt/bluffing-valley/src/` | admin | Plain-node poker WS modules imported by `server.js` at runtime (§2.5.1) |
| `/opt/bluffing-valley/scripts/db-backup.sh` | admin | Nightly DB backup (see § Database backups) |
| `/etc/systemd/system/bluffing-valley.service` | root | systemd unit (§2.5) |
| `/etc/caddy/Caddyfile` | root | Reverse proxy + TLS (§2.6) |
| `journalctl -u bluffing-valley` | systemd-journald | App stdout/stderr |
| `journalctl -u caddy` | systemd-journald | Proxy logs |
| local MySQL `127.0.0.1:3306` db `statisticasino` | mysql | App database |

### Environment variables actually used

See `README.md`'s "Environment variables" table for the full list. In production we
set (local DB — the old RDS is retired):

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=riverside
MYSQL_PASSWORD=…                  # generated on-box, in .env only
MYSQL_DATABASE=statisticasino
MYSQL_SSL=0
GMAIL_USER=…                      # blank -> stub mode (see §7)
GMAIL_APP_PASSWORD=…              # 16-char app password
GMAIL_FROM_NAME=Bluffing Valley
OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT   # media (§Social/OSS)
TURN_URL / TURN_SECRET / TURN_TTL # voice (§Voice)
REPLAY_ARCHIVE_URL=http://127.0.0.1:8790   # replay archive tunnel (§Replay archive)
PORT=3000
HOST=127.0.0.1                    # adapter-node binds loopback only; Caddy is the only reacher
ORIGIN=https://bluffingvalley.blopybox.net
```

`ORIGIN` is the one most likely to bite you: SvelteKit uses it both to construct
canonical URLs **and** to validate the `Origin` header on cross-site form POSTs. If
browsers visit over `https://` but `ORIGIN` says `http://`, every form submit is
rejected 403 by SvelteKit's CSRF guard. With Caddy terminating TLS and the site
served over `https://bluffingvalley.blopybox.net`, keep `ORIGIN` on `https://`.

The `/api/flush` endpoint is exempt — `svelte.config.js` sets
`csrf.checkOrigin: false` because the Chrome extension posts from a
`chrome-extension://…` origin that can never match.

---

## 5. Mainland-China ICP gotcha (historical lesson — no longer in the live path)

> This section is history. The current origin is in **HK** (§1), so ICP does not
> apply. Kept because it explains *why* we host overseas, and what to expect if you
> ever put an origin back in mainland China.

We originally provisioned the origin in `cn-shenzhen` (Aliyun ECS `8.135.45.55`).
Everything worked when probed by IP. The instant a registered domain was pointed at
it, every HTTP request returned a 403 with `<title>Non-compliance ICP Filing</title>`.
**Aliyun's edge intercepts traffic destined for mainland-China instances when the
HTTP `Host` header matches a registered domain that has no ICP filing.** Cloudflare
in front does not help — CF forwards the visitor's `Host` verbatim, so the
interception fires at Aliyun's edge before our proxy sees the connection.

Confirmed by sending different `Host` headers to the SZ origin:

| `Host:` value | Aliyun edge | Reaches our proxy? |
| - | - | - |
| the bare IP | passes | yes (200) |
| a registered, unfiled domain | **blocks** | no (403 Aliyun page) |
| a non-registered host | passes | yes (200) |

Options if you go mainland again: (1) file ICP (7–20 days, PRC ID + paperwork),
(2) a Cloudflare Origin Rule rewriting `Host` to the bare IP (works, but is a
regulatory bypass that depends on Aliyun keeping the heuristic), or (3) host
overseas (`cn-hongkong`/elsewhere) — what we do now. Don't bother debugging the
proxy or the app; the request never gets there.

---

## 6. Pending follow-ups (TODO)

- [ ] **VPS expiry (2026-09-20, auto-renew OFF).** Renew the SWAS instance or
      migrate to a new box via §2 before it lapses. See the note at the bottom.
- [ ] **Origin TLS is already done by Caddy** (auto Let's Encrypt) — no certbot
      needed. Nothing to do unless you move off Caddy.
- [ ] **Rate-limit `/api/flush`.** The app caps at 50 MB/request, but a botnet
      posting small junk in a loop still consumes DB writes. Add a Caddy
      `rate_limit` (or app-level cap keyed on client IP) if abuse appears.
- [ ] **Off-box DB backup breadth.** The nightly dump (§ Database backups) is
      mirrored to mini2, but excludes play history by policy. If the account/economy
      state ever needs point-in-time recovery beyond 7 dumps, widen retention.

---

## 7. Gmail SMTP setup (signup verification codes)

Signup mails 6-digit codes via Gmail's SMTP gateway over implicit TLS
(`smtps://smtp.gmail.com:465`). The implementation in `src/lib/server/email.js` is
`nodemailer` + an app-scoped Gmail password. With either of `GMAIL_USER` or
`GMAIL_APP_PASSWORD` empty, the module falls back to **stub mode**: codes print to
`journalctl` instead of being mailed. New deployments boot in stub mode; flip to
real mail by completing §7.1 and filling in `.env`.

Why Gmail SMTP over a transactional vendor: the credential is the operator's own
Google account (no third party in the trust chain); no DNS/DKIM warmup (Gmail signs
outbound); and Aliyun blocks egress port 25 by default (ruling out self-hosted
Postfix), while 465 (SMTPS) is open. Trade-off: the From address is locked to
`<GMAIL_USER>` (display name configurable). `email.js` exports a provider-agnostic
`sendEmail()` shape, so swapping to DirectMail/SES later is a single-file edit.

### 7.1 One-time Google account configuration

1. **Enable 2-Step Verification** on the sending account
   (<https://myaccount.google.com/security>).
2. **Generate an app password** at <https://myaccount.google.com/apppasswords>, name
   it `Bluffing Valley`, **Create**. Google shows a 16-char password once — copy it
   (spaces are decorative).
3. **(Optional) Smoke-test standalone** before deploying:
   ```bash
   printf 'From: %s\nTo: %s\nSubject: SMTP probe\n\nhello\n' \
     you@gmail.com you@gmail.com | \
   curl --ssl-reqd --url 'smtps://smtp.gmail.com:465' \
     --user 'you@gmail.com:abcdefghijklmnop' \
     --mail-from 'you@gmail.com' --mail-rcpt 'you@gmail.com' -T -
   ```
   `250 2.0.0 OK` near the end means the credentials are valid.
4. **Edit `/opt/bluffing-valley/.env`** on the box:
   ```
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop
   GMAIL_FROM_NAME=Bluffing Valley
   ```
   `sudo systemctl restart bluffing-valley`.
5. **End-to-end**: open the signup page, type a real email, click **Send code**. The
   hint should switch from "(Email provider not configured)" to "Code sent". First
   message from a new sender often lands in Spam — mark "Not Spam" once.

### 7.2 Stub mode (no Gmail creds)

Leaving either of `GMAIL_USER` / `GMAIL_APP_PASSWORD` empty puts `email.js` in stub
mode. Signup still works — codes are issued/validated/stored — but the server prints
the code instead of mailing it. Grab it on the box:

```bash
ssh hk 'journalctl -u bluffing-valley -n 200 --no-pager | grep "email:stub" | tail -1'
```

### 7.3 Failure-mode reading

| Log line snippet | Meaning | Fix |
| - | - | - |
| `Invalid login: 535-5.7.8 Username and Password not accepted` | App password wrong/regenerated, or 2FA off. | Re-run §7.1 step 2; update `.env`; restart. |
| `Daily user sending limit exceeded` | 500/day quota tripped. | Wait 24h, or Workspace (2000/day) / DirectMail / SES. |
| `Connection timeout` to `smtp.gmail.com:465` | Egress to 465 blocked. | `curl -v telnet://smtp.gmail.com:465`. |
| `EAUTH` `Application-specific password required` | Used the regular Gmail password. | Use an app password (§7.1 step 2). |

---

## 8. Quick reference: contact points

| What | Where |
| - | - |
| Production SSH | `ssh hk` (user `admin`, key `~/.ssh/aliyun_hk_ed25519`) |
| Box | Aliyun HK **SWAS** `c91a2e4803b74799aa1a0ad774194e77`, region `cn-hongkong`, `47.243.163.51`, Ubuntu 24.04 |
| Reverse proxy | Caddy, `/etc/caddy/Caddyfile` (reload, never restart) |
| Database | **local** MySQL `127.0.0.1:3306`, db `statisticasino`, user `riverside` |
| DNS / TLS | Cloudflare zone `blopybox.net` (`bluffingvalley` A, DNS-only); Caddy issues certs |
| Public site | <https://bluffingvalley.blopybox.net/> |
| Chrome extension repo | `casinoMalwareExtension/` (sibling dir) |

---

## Voice chat + coturn (added 2026-08-25)

Table voice is a WebRTC audio mesh; signaling rides the existing WebSocket, media is
P2P with a self-hosted **coturn** TURN relay for the peers that can't connect
directly. Mesh self-healing (ICE restart → relay-only rebuild → backoff) shipped
2026-09-10.

**coturn** (installed via `apt install coturn`; port **3479** because Netbird owns
3478 on this box):

- `/etc/turnserver.conf`: `use-auth-secret` + `static-auth-secret=<32-byte hex>`,
  `listening-port=3479`, `external-ip=47.243.163.51/172.19.52.134` (1:1 NAT —
  advertise the PUBLIC ip), `min-port=49152 max-port=49200`, `no-tls no-dtls`
  (plain UDP for v1), and `denied-peer-ip` ranges covering all RFC1918 / loopback /
  169.254 (SSRF hardening — TURN must never relay into the VPC/metadata). Enable with
  `TURNSERVER_ENABLED=1` in `/etc/default/coturn`.
- App `/opt/bluffing-valley/.env`: `TURN_URL=turn:47.243.163.51:3479?transport=udp`,
  `TURN_SECRET=<same secret>`, `TURN_TTL=3600`. The server hands the browser a
  short-lived HMAC credential derived from the secret (see `src/lib/server/voice.js`).

**Firewall — the box is an Aliyun SWAS instance**, so inbound is gated by the **SWAS
firewall**, not an ECS security group. These UDP rules are already live (verified
2026-09-07):

| Protocol | Port | Source |
|---|---|---|
| UDP | 3479          | 0.0.0.0/0 |
| UDP | 49152/49200   | 0.0.0.0/0 |

Manage with `aliyun swas-open {ListFirewallRules,CreateFirewallRule,DeleteFirewallRule}
--profile claude --RegionId cn-hongkong --InstanceId c91a2e4803b74799aa1a0ad774194e77
--force` (the CLI's swas-open metadata is stale → `--force`; single port = `3479`,
range = `49152/49200`; the `claude` profile uses the `claude-automation` RAM key).
Verified end-to-end: external STUN responds and a `turnutils_uclient` TURN
allocate/relay showed 0 packet loss; two headless Chromes with fake mics reach peer
state "connected" (`scripts/e2e/prod-recover.sh`).

Later hardening: a `turns:` (TLS) listener on 443 needs a cert + a DNS-only record
for a TURN subdomain (TURN is UDP and can't ride Cloudflare's HTTP proxy).

## Known issues

- **FIXED (2026-08-25): the "~8h restart" bug.** `bluffing-valley.service` used to
  exit ~every 8h — the MySQL advisory-lock ("instance lease") connection idle-timed
  out (MySQL `wait_timeout`), dropping `GET_LOCK` and tripping the split-brain
  fail-stop. Fix: a 4-min `SELECT 1` keepalive on the lease connection
  (`LEASE_KEEPALIVE_MS`, unref'd) in `bank.js#acquireInstanceLease`. A genuinely
  dead lease connection still fail-stops so systemd restarts cleanly. This applied
  on the old RDS and still applies on local MySQL.

## Database backups (nightly, NO play history)

Owner policy (2026-09-07): play history is never backed up — not the replays, not
the hand history, not the imported captures — only the account/economy/social state.

* VPS: `/opt/bluffing-valley/scripts/db-backup.sh` runs from the `admin` crontab at
  03:30 UTC (`mysqldump --single-transaction` of the app DB **excluding**
  `match_replay`, `match_replay_player`, `poker_hand`, `poker_hand_player`,
  `hand_canonical`, `hand_upload`) → `/var/backups/bluffing-valley/db-YYYYMMDD-HHMM.sql.gz`,
  last 7 kept, log in `backup.log`. The script fails loudly if the dump lacks
  mysqldump's "Dump completed" trailer.
* mini2: the hourly archive puller (`~/riverside-archive/bin/pull.sh`) mirrors that
  folder to `~/riverside-archive/db/` first and keeps 30 days.
* Restore: `gzip -dc db-….sql.gz | sudo mysql <database>` (verified 2026-09-07 into a
  scratch DB: 24 tables restore cleanly). Recreate the history tables by booting the
  app: `ensureMigrated()` applies `schema.sql` (`CREATE TABLE IF NOT EXISTS`) on start.

## Replay archive (tiering to the home Mac mini)

Matches older than **7 days** have their big `match_replay.replay_json` moved to
**mini2** (`~/riverside-archive/replays/YYYY/MM/DD/<id>.json.gz`); the VPS keeps
metadata + participants + `final_json`, so stats/history/access never depend on home
— only the step-through of an old replay does.

**mini2 pulls, the VPS never reaches home.** Three LaunchDaemons on mini2
(`/Library/LaunchDaemons/com.johnzhu.riverside-archive-{pull,serve,tunnel}.plist`,
user `john.zhu`, Ruby stdlib only):
- `pull` — hourly `~/riverside-archive/bin/pull.sh`: SSH to hk → `node
  scripts/replay-archive.mjs export` → rsync → verify every sha256 → move files
  read-only → `mark` (VPS re-hashes the live row, then NULLs it) → `cleanup` →
  `prune-legacy`. Log `~/riverside-archive/logs/pull.log` (self-capped 3000 lines).
- `serve` — `ruby -run -e httpd ~/riverside-archive -p 8790 --bind-address=127.0.0.1`.
- `tunnel` — `ssh -N -R 127.0.0.1:8790:127.0.0.1:8790 admin@47.243.163.51`
  (KeepAlive); the VPS reads archived files at
  `REPLAY_ARCHIVE_URL=http://127.0.0.1:8790` (in `/opt/bluffing-valley/.env`), 2.5 s
  timeout, summary fallback when home is offline.

Ops: `ssh mini2 'tail ~/riverside-archive/logs/pull.log'`; run a pull now with
`ssh mini2 'sudo launchctl kickstart -k system/com.johnzhu.riverside-archive-pull'`;
check the tunnel from the VPS with
`ssh hk 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8790/replays/'`.
**Teardown (mini2):** `for n in pull serve tunnel; do sudo launchctl bootout system/com.johnzhu.riverside-archive-$n; sudo rm /Library/LaunchDaemons/com.johnzhu.riverside-archive-$n.plist; done`
(keep `~/riverside-archive/replays` — it is the ONLY copy of archived replays).

---

## VPS expiry — DECISION: LET IT LAPSE (owner, 2026-09-15)

The rented Aliyun HK SWAS box **expires `2026-09-20T16:00Z`** with **auto-renew
OFF**. **Owner's decision (2026-09-15): let it lapse** — no renew, no migrate. On the
20th `bluffingvalley.blopybox.net`, voice/coturn, and the replay-archive tunnel stop.

**Before the 20th — the one thing to confirm:** with the box gone, the *only*
surviving copy of the data is the nightly DB backup mirrored to **mini2**
(`~/riverside-archive/db/`, minus play history by policy). On 2026-09-15 mini2 was
offline (NetBird "Idle"; the HK→mini2 tunnel was down), so mirror freshness was
unverified. Once mini2 is awake, confirm the mirror is current:
```bash
ssh mini2 'ls -laht ~/riverside-archive/db/ | head; tail ~/riverside-archive/logs/pull.log'
```
The VPS-side backup chain itself is healthy (cron 03:30 UTC, dump verified
2026-09-15). If the decision ever changes, §2 is the accurate migration runbook and
the SWAS instance is `c91a2e4803b74799aa1a0ad774194e77` (`cn-hongkong`).
