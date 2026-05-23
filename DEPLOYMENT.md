# Deployment runbook

How `statisticasino` actually runs in production today, and the steps to
get it back up from a blank Linux box. The generic "Production" section
in [`README.md`](./README.md#production) covers the framework-level
recipe; this file is the concrete, "what we shipped", warts-and-all
record.

If you're picking this up cold, read **§1 (architecture)** and
**§5 (mainland-China ICP gotcha)** first — those two sections explain
*why* the production layout looks the way it does.

---

## 1. Architecture

```
   Browser            Cloudflare           Aliyun HK ECS               Aliyun RDS (SZ)
 ┌──────────┐        ┌──────────┐        ┌────────────────────┐       ┌──────────────┐
 │ user     │ HTTPS  │ proxied  │  HTTP  │ nginx :80 (vhost)  │  TCP  │ MySQL 8 :3306│
 │ /        ├───────►│ DNS +    ├───────►│  ↳ 127.0.0.1:3000  ├──────►│ statisticasino│
 │ /api/... │        │ optional │        │ node /opt/.../build│       │              │
 │ /data    │        │ caching  │        │ (systemd unit)     │       │              │
 └──────────┘        └──────────┘        └────────────────────┘       └──────────────┘
                          ▲                        ▲
                          │                        │
                  www.sinostatistica.net    47.86.216.211
                  sinostatistica.net        (must be in RDS allowlist)
```

- **Origin**: Aliyun HK ECS, Alibaba Cloud Linux 4, public IP
  `47.86.216.211`, internal `10.18.128.145/24`. Provisioned outside
  mainland China specifically to sidestep ICP filing — see §5.
- **Reverse proxy**: nginx 1.26.2 listening on `:80`, single vhost in
  `/etc/nginx/conf.d/statisticasino.conf`. TLS is terminated at
  Cloudflare for now; the origin speaks plain HTTP only.
- **App**: SvelteKit (adapter-node) running as `node /opt/statisticasino/build`,
  managed by systemd unit `statisticasino.service`, listens on
  `127.0.0.1:3000`.
- **Database**: Aliyun RDS for MySQL 8 in `cn-shenzhen`. The HK ECS's
  egress IP must be allowlisted in the RDS console; cross-region
  latency is single-digit ms.
- **DNS**: Cloudflare nameservers, `www` and apex A records both point
  at `47.86.216.211`, both proxied (orange cloud). Universal SSL is
  enabled, but CF→origin is currently HTTP (Flexible/Full TLS mode
  needs the §6 follow-up to be fully consistent).

---

## 2. From-scratch deploy

Tested 2026-05-22 on a blank Aliyun ECS HK instance. All commands run
on a developer laptop unless they're in an `ssh '…'` block.

### 2.1 Pre-flight

- ECS image: any reasonably modern Linux with `dnf` or `apt` and
  systemd. Alibaba Cloud Linux 4 is what we use.
- Aliyun Security Group: inbound `22/22` (SSH) and `80/80` (HTTP) from
  `0.0.0.0/0`. Add `443/443` later if/when you do TLS at origin.
- Aliyun RDS allowlist: include the new ECS's egress IP. Easy way
  to find it: `ssh root@<ip> 'curl -s https://ipinfo.io/ip'`.
- A copy of the SSH key locally, with `chmod 600`.

### 2.2 Install runtime

```bash
ssh -i path/to/key.pem root@<server-ip> '
  dnf -y install nodejs nginx tar rsync curl
  node --version    # expect v20+
  nginx -v
  mkdir -p /opt/statisticasino
'
```

Alibaba Cloud Linux 4 ships Node 22 in its default repo, so no
NodeSource setup is needed. On Debian/Ubuntu, prefer NodeSource so the
version is recent and pinned.

### 2.3 Build locally and ship

```bash
cd statisticasino
npm install
npm run build      # produces build/ via @sveltejs/adapter-node
                   # also rebuilds static/downloads/casino-inspector.zip

rsync -az --delete \
  --exclude=node_modules/ --exclude=.svelte-kit/ --exclude=.git/ \
  --exclude=.idea/ --exclude=.DS_Store --exclude='smoke-*.sqlite*' \
  --exclude=.env \
  -e 'ssh -i path/to/key.pem' \
  ./ root@<server-ip>:/opt/statisticasino/
```

We deliberately ship `build/` from local instead of building on the
ECS — the box only has 1.7Gi of RAM and Vite's build is heavier than
that comfortably allows. We also exclude `.env` so secrets only live
on the server.

### 2.4 Configure secrets and install runtime deps

Write `/opt/statisticasino/.env` directly on the box (do **not** rsync
it from your laptop's working tree):

```bash
ssh -i path/to/key.pem root@<server-ip> 'cat > /opt/statisticasino/.env <<EOF
MYSQL_HOST=rm-XXXX.mysql.cn-shenzhen.rds.aliyuncs.com
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=__rotate_me__
MYSQL_DATABASE=statisticasino
MYSQL_SSL=0

# Gmail SMTP. Leave empty for stub mode (verification codes print
# to journalctl instead of being mailed). See §7 for setup.
GMAIL_USER=
GMAIL_APP_PASSWORD=
GMAIL_FROM_NAME=Statisticasino

PORT=3000
HOST=127.0.0.1
ORIGIN=http://www.sinostatistica.net
EOF
chmod 600 /opt/statisticasino/.env

cd /opt/statisticasino
npm ci --omit=dev --no-audit --no-fund
node scripts/migrate.js
'
```

`scripts/migrate.js` reads `.env`, applies `src/lib/server/schema.sql`
(idempotent `CREATE TABLE IF NOT EXISTS …`), runs `migrateToV5` /
`migrateToV7`, and inserts the hardcoded-admin shell row. The admin's
**password lives in `src/lib/server/auth.js#HARDCODED_ADMIN_PASSWORD`**,
not in `.env` — `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars are no
longer read.

Heads-up: `migrateToV7` runs `DELETE FROM user` on first upgrade. Any
ordinary accounts that existed under the previous schema are wiped
(sessions cascade, upload audit rows are anonymised). Re-create them
via the signup form. If it errors with `ER_HOST_NOT_PRIVILEGED` you
forgot to allowlist the ECS egress IP in RDS (§2.1).

### 2.5 systemd unit

`/etc/systemd/system/statisticasino.service`:

```ini
[Unit]
Description=Statisticasino SvelteKit (adapter-node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/statisticasino
EnvironmentFile=/opt/statisticasino/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/statisticasino/build
Restart=always
RestartSec=2
# adapter-node does not install a SIGTERM handler that closes the
# mysql2 pool, so the default 90s stop timeout stalls every redeploy.
TimeoutStopSec=10
KillSignal=SIGTERM
KillMode=mixed
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=statisticasino

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now statisticasino
systemctl is-active statisticasino    # active
ss -tlnp | grep 3000                  # node listening on 127.0.0.1:3000
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200
```

### 2.6 nginx

Comment out the bundled default `server` block in `/etc/nginx/nginx.conf`
so our vhost owns the `default_server` slot, then drop in
`/etc/nginx/conf.d/statisticasino.conf`:

```nginx
map $http_upgrade $http_connection {
    default upgrade;
    "" close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name www.sinostatistica.net sinostatistica.net 47.86.216.211 _;

    include /etc/nginx/snippets/cloudflare-real-ip.conf;

    # /api/flush accepts gzipped game captures from the Chrome extension.
    # In-app cap is 50 MB; allow some headroom so the app, not the
    # proxy, returns the useful error on borderline uploads.
    client_max_body_size 64m;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $http_connection;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

The `_` server_name (matches "anything") is a deliberate fallback so
that direct-IP probes and any future CF Origin Rule that rewrites the
Host header still land here. Mainland-China ICP enforcement happens
upstream of nginx, so we do not try to gate anything at this layer.

#### 2.6.1 Cloudflare real-IP snippet

`/etc/nginx/snippets/cloudflare-real-ip.conf` is generated from CF's
published IP ranges so that `$remote_addr` and access-log entries
reflect the visitor, not a CF edge node:

```bash
{
  printf '# Auto-generated %s. Refresh by re-running deploy.\n' "$(date -Iseconds)"
  for url in https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6; do
    while IFS= read -r cidr; do
      [ -n "$cidr" ] && printf 'set_real_ip_from %s;\n' "$cidr"
    done < <(curl -fsSL "$url")
  done
  printf 'real_ip_header CF-Connecting-IP;\n'
  printf 'real_ip_recursive on;\n'
} > /etc/nginx/snippets/cloudflare-real-ip.conf
```

Re-run this once or twice a year — CF expands the ranges occasionally.

### 2.7 DNS (Cloudflare)

Cloudflare → your zone → DNS → Records:

- `A www.sinostatistica.net 47.86.216.211 (Proxied)`
- `A sinostatistica.net 47.86.216.211 (Proxied)`

SSL/TLS → Overview: see §6 about Flexible vs Full mode. Today: leave
at Full and accept that `https://...` returns 521; users go via
`http://...`.

### 2.8 Smoke test

```bash
# DNS
dig +short www.sinostatistica.net    # cloudflare IPs
# HTTP
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://www.sinostatistica.net/
# /api/flush wired up correctly (400 with JSON body == ok, 5xx == bad)
curl -sS -X POST -H 'Content-Type: application/json' --data '{"_probe":true}' \
  http://www.sinostatistica.net/api/flush
# Real-IP transparency
ssh root@<server-ip> 'tail -n 5 /var/log/nginx/access.log'
# The first column should show your laptop's egress IP, not a CF range.
```

---

## 3. Day-2 operations

### 3.1 Redeploy after a code change

```bash
cd statisticasino
npm run build
rsync -az --delete \
  --exclude=node_modules/ --exclude=.svelte-kit/ --exclude=.git/ \
  --exclude=.idea/ --exclude=.DS_Store --exclude='smoke-*.sqlite*' \
  --exclude=.env \
  -e 'ssh -i path/to/key.pem' \
  ./ root@47.86.216.211:/opt/statisticasino/
ssh -i path/to/key.pem root@47.86.216.211 \
  'cd /opt/statisticasino && npm ci --omit=dev && systemctl restart statisticasino'
```

`migrate.js` is idempotent and runs at every server boot via
`hooks.server.js#ensureMigrated`, so you usually do not need to invoke
it explicitly.

### 3.2 Inspecting

```bash
ssh -i path/to/key.pem root@47.86.216.211

# App
systemctl status statisticasino
journalctl -u statisticasino -f               # live tail
journalctl -u statisticasino --since '5min ago'

# Reverse proxy
nginx -T | head -n 80                          # rendered effective config
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Listening ports
ss -tlnp
```

### 3.3 Restarts

```bash
systemctl restart statisticasino   # ~1s thanks to TimeoutStopSec=10
systemctl reload nginx             # zero-downtime config reload
```

### 3.4 Rotating secrets

`MYSQL_PASSWORD` rotation:

1. RDS console → Data Security → reset password.
2. `ssh root@<box> 'sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=NEW|" /opt/statisticasino/.env && systemctl restart statisticasino'`.
3. `journalctl -u statisticasino -n 50 --no-pager` — first /api/flush
   (or any DB-touching request) should succeed.

Admin password rotation (schema v7): edit
`src/lib/server/auth.js#HARDCODED_ADMIN_PASSWORD`, run a fresh
`npm run build` locally, rsync the updated `build/` and `src/` to
the box, then `systemctl restart statisticasino`. There is **no**
env-driven admin secret any more — the constant in `auth.js` is the
sole source of truth.

`GMAIL_APP_PASSWORD` rotation: revoke at
<https://myaccount.google.com/apppasswords>, generate a new one,
edit `.env`, `systemctl restart statisticasino`. The next signup
attempt sends under the new password; in-flight verification rows
survive (the password isn't mixed into the code-hash).

---

## 4. File / config reference

| Path on origin | Owner | Purpose |
| - | - | - |
| `/opt/statisticasino/` | root | App code (rsynced from local) |
| `/opt/statisticasino/.env` | root, `0600` | Production secrets (DB, admin, ORIGIN) |
| `/opt/statisticasino/build/` | root | adapter-node output (`node build` runs this) |
| `/opt/statisticasino/node_modules/` | root | Runtime deps (`npm ci --omit=dev`) |
| `/etc/systemd/system/statisticasino.service` | root | systemd unit (§2.5) |
| `/etc/nginx/conf.d/statisticasino.conf` | root | Site vhost (§2.6) |
| `/etc/nginx/snippets/cloudflare-real-ip.conf` | root | CF IP allowlist (§2.6.1) |
| `/var/log/nginx/{access,error}.log` | nginx | Standard nginx logs |
| `journalctl -u statisticasino` | systemd-journald | App stdout/stderr |

### Environment variables actually used

See `README.md`'s "Environment variables" table for the full list. In
production we set:

```
MYSQL_HOST=rm-XXXX.mysql.cn-shenzhen.rds.aliyuncs.com
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=…
MYSQL_DATABASE=statisticasino
MYSQL_SSL=0
GMAIL_USER=zhufengyuejohn@gmail.com    # blank -> stub mode (see §7)
GMAIL_APP_PASSWORD=…                   # 16-char app password
GMAIL_FROM_NAME=Statisticasino
PORT=3000
HOST=127.0.0.1                    # so adapter-node binds loopback only;
                                  # nginx is the only thing that reaches us
ORIGIN=http://www.sinostatistica.net
```

The admin's email + password are **hardcoded** in
`src/lib/server/auth.js`; see §3.4 for rotation. There is no
`ADMIN_EMAIL` / `ADMIN_PASSWORD` env var any more.

`ORIGIN` is the one most likely to bite you on next change: SvelteKit
uses it both to construct canonical URLs **and** to validate the
`Origin` header on cross-site form POSTs. If browsers visit you over
`https://` but `ORIGIN` says `http://`, every form submission will be
rejected with a 403 by SvelteKit's CSRF guard. Keep these in lockstep:

| Visitor scheme | `ORIGIN` value |
| - | - |
| `http://www.sinostatistica.net` | `http://www.sinostatistica.net` (current) |
| `https://www.sinostatistica.net` (CF Flexible/Full) | `https://www.sinostatistica.net` |

The `/api/flush` endpoint is exempt from this — `svelte.config.js` sets
`csrf.checkOrigin: false` because the Chrome extension posts from a
`chrome-extension://...` origin which can never match.

---

## 5. Mainland-China ICP gotcha (lesson learned)

We originally provisioned the origin in `cn-shenzhen` (Aliyun ECS
8.135.45.55). Everything worked when probed by IP. The instant
`www.sinostatistica.net` was pointed at it, every HTTP request
returned a 403 with `<title>Non-compliance ICP Filing</title>` and a
redirect to `aliyun.com/beian/beian-block?id=...`. **Aliyun's edge
intercepts traffic destined for mainland-China ECS instances when the
HTTP `Host` header matches a registered domain that has no ICP filing
on the owning account.** Cloudflare being in front does not help: CF
forwards the visitor's `Host` header verbatim, so the interception
still fires at Aliyun's edge before our nginx sees the connection.

We confirmed the heuristic by sending different `Host` headers
directly to the SZ origin:

| `Host:` value | Aliyun edge | Reaches our nginx? |
| - | - | - |
| `8.135.45.55` (the bare IP) | passes | yes (200) |
| `www.sinostatistica.net` (registered, unfiled) | **blocks** | no (403 Aliyun page) |
| `probe-test-noexist.invalid` | passes | yes (200) |
| `x.example.com` (someone else's domain) | passes | yes (200) |

So the filter is keyed specifically on registered domain names that
resolve into mainland-China-hosted IPs without an ICP filing. Random
non-registered Hosts and the bare IP slip through.

### Workarounds we considered

1. **File ICP for the domain** (the official path). Takes 7-20 days,
   requires PRC ID, photo, and a record-keeping host that the
   regulators trust. Most permanent, most paperwork.
2. **Cloudflare Origin Rule rewriting the Host header to the bare IP**
   before forwarding to origin. Bypasses the filter because Aliyun
   only sees `Host: 8.135.45.55`. Works today, but is technically a
   regulatory bypass; depends on Aliyun's edge keeping the same
   heuristic forever.
3. **Move the origin out of mainland China.** ICP doesn't apply to
   `cn-hongkong` / overseas ECS. We picked this — see §1. The DB stays
   in `cn-shenzhen`; cross-region latency is single-digit ms which is
   fine for our request volume.

If you ever bring up a mainland-China origin again (e.g. for cost or
network-locality reasons), expect to either ICP-file or run the CF
Origin Rule trick. Do **not** bother debugging nginx or the app — the
request never gets there.

---

## 6. Pending follow-ups (TODO)

Roughly in order of bite/value:

- [ ] **Decommission the old SZ ECS** (`8.135.45.55`). DNS no longer
      points at it. Stop it for a day or two to confirm nothing was
      relying on it (e.g. an extension build with a stale
      `FLUSH_ENDPOINT`), then release it. Before releasing, scrub
      `.env`/`/opt/statisticasino/.env.bak` so the snapshot does not
      keep an old MYSQL password.
- [ ] **Rotate `MYSQL_PASSWORD`.** It was committed to chat history,
      lived on two ECS instances, and has a `.env.bak` copy on the SZ
      box. Cycle it via the RDS console + the runbook in §3.4.
- [ ] **Tighten the RDS allowlist.** It currently accepts the HK IP,
      which suggests the rule is `0.0.0.0/0` or similarly broad.
      Replace with `47.86.216.211/32` plus your dev laptop's IP.
      Verify by `ssh root@47.86.216.211 'node scripts/migrate.js'`
      after each tweak.
- [ ] **Update the Chrome extension's `FLUSH_ENDPOINT`** (in
      `casinoMalwareExtension/serialize.js`) and `host_permissions`
      (in `casinoMalwareExtension/manifest.json`) to
      `http://www.sinostatistica.net/api/flush` /
      `http://www.sinostatistica.net/*`. Bump
      `manifest.json#version` and rebuild
      (`statisticasino && npm run build` regenerates the `.zip` on
      `/contribute`).
- [ ] **Origin TLS via certbot** so we can move CF SSL/TLS mode from
      Flexible (or current 521-emitting Full) to **Full (strict)**:
      ```bash
      ssh root@47.86.216.211 '
        dnf -y install certbot python3-certbot-nginx
        certbot --nginx -d www.sinostatistica.net -d sinostatistica.net \
          --non-interactive --agree-tos -m you@example.com --redirect
      '
      ```
      Then flip `.env`'s `ORIGIN` to `https://www.sinostatistica.net`
      and `systemctl restart statisticasino`. CF dashboard → SSL/TLS
      → Overview → **Full (strict)**. Verify forms still submit
      cleanly (they exercise the CSRF path).
- [ ] **Off-site DB backup.** RDS daily snapshots cover us against
      RDS-internal corruption, but not against an account compromise
      that drops the snapshots too. A weekly `mysqldump | gzip`
      to OSS or to your laptop costs almost nothing.
- [ ] **Rate-limit `/api/flush`.** Currently uncapped at the proxy
      layer. The app caps at 50 MB per request, but a botnet posting
      1 KB junk in a loop would still consume DB writes. nginx
      `limit_req_zone` keyed on `$binary_remote_addr` (which is the
      visitor's IP thanks to the CF real-IP snippet) is the easiest
      lever.

---

## 7. Gmail SMTP setup (signup verification codes)

Signup mails 6-digit codes via Gmail's SMTP gateway over implicit TLS
(`smtps://smtp.gmail.com:465`). The implementation in
`src/lib/server/email.js` is `nodemailer` + an app-scoped Gmail
password. With either of `GMAIL_USER` or `GMAIL_APP_PASSWORD` empty,
the module falls back to **stub mode**: codes are printed to
`journalctl` instead of being mailed. New deployments boot in stub
mode; flip to real mail by completing §7.1 and filling in `.env`.

Why Gmail SMTP over a transactional-mail vendor (Aliyun DirectMail,
AWS SES, Resend, Mailgun, …):

* The credential is the operator's own Google account, no third-party
  vendor in the trust chain.
* No DNS work — Gmail signs every outbound message with its own DKIM
  and inherits Google's IP reputation, so emails to Gmail/Outlook/etc.
  land in the inbox without any SPF/DKIM warmup.
* Cloud egress port 25 is blocked by default on Aliyun ECS, ruling out
  a self-hosted Postfix. Port 465 (SMTPS) is open.

The trade-off is the From: address is locked to `<GMAIL_USER>@gmail.com`
(Gmail rewrites mismatched froms). Display name is configurable. For
a school project this is fine; if you eventually want a custom
`@sinostatistica.net` from-address, swap to DirectMail or SES — the
swap is a single-file edit because `email.js` exports a
provider-agnostic `sendEmail()` shape.

### 7.1 One-time Google account configuration

1. **Enable 2-Step Verification.** App passwords don't exist without
   it. Visit <https://myaccount.google.com/security> on the account
   you'll send from (we use `zhufengyuejohn@gmail.com`) and turn it on
   if it isn't already.
2. **Generate an app password.** Go to
   <https://myaccount.google.com/apppasswords> directly (the link is
   sometimes hidden in the regular Security UI). Name it
   `Statisticasino`, click **Create**. Google shows a 16-character
   password ONCE — copy it. Spaces are decorative; the app accepts
   the value with or without them.
3. **(Optional) Smoke-test the credentials standalone** before
   deploying. Pipe a tiny RFC-5322 message into curl:
   ```bash
   printf 'From: %s\nTo: %s\nSubject: SMTP probe\n\nhello\n' \
     zhufengyuejohn@gmail.com zhufengyuejohn@gmail.com | \
   curl --ssl-reqd \
     --url 'smtps://smtp.gmail.com:465' \
     --user 'zhufengyuejohn@gmail.com:abcdefghijklmnop' \
     --mail-from 'zhufengyuejohn@gmail.com' \
     --mail-rcpt 'zhufengyuejohn@gmail.com' \
     -T -
   ```
   `< 250 2.0.0 OK` near the end means the credentials are valid.
   `535-5.7.8 Username and Password not accepted` means the app
   password is wrong (or you typed your regular Gmail password by
   mistake).
4. **Edit `/opt/statisticasino/.env`** on the production box:
   ```
   GMAIL_USER=zhufengyuejohn@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop
   GMAIL_FROM_NAME=Statisticasino
   ```
   `systemctl restart statisticasino`.
5. **End-to-end smoke test.** Open
   <http://www.sinostatistica.net/account/signup>, type a real email,
   click **Send code**. The signup-page hint should switch from
   "(Email provider not configured)" to "Code sent. Check your inbox
   (and spam folder)." First message from a new sender often lands
   in **Spam** on Gmail / **Junk** on Outlook — mark "Not Spam" once
   and future ones go straight to Inbox.

### 7.2 Stub mode (no Gmail creds)

Leaving either of `GMAIL_USER` or `GMAIL_APP_PASSWORD` empty puts
`email.js` in stub mode. Signup still works — codes are issued,
validated, and stored as before — but instead of emailing the
plaintext, the server prints:

```
[email:stub] to=user@example.com subject="Your Statisticasino verification code" text="Your verification code is: 384719\n\n..."
```

To grab the code on the production box:

```bash
ssh root@47.86.216.211 \
  'journalctl -u statisticasino -n 200 --no-pager | grep "email:stub" | tail -1'
```

### 7.3 Failure-mode reading

When sending fails after the credentials are configured,
`email.js` logs a `[email:gmail] send failed: ...` line and the
`?/sendCode` action returns `502 Could not send the email`. Common
causes:

| Log line snippet | Meaning | Fix |
| - | - | - |
| `Invalid login: 535-5.7.8 Username and Password not accepted` | App password wrong, regenerated, or 2FA was disabled. | Re-run §7.1 step 2; update `.env`; restart. |
| `Daily user sending limit exceeded` | 500/day quota tripped. | Wait 24h, or migrate to Workspace (2000/day) / DirectMail / SES. |
| `Connection timeout` to `smtp.gmail.com:465` | Cloud egress to 465 was blocked / firewalled. | Verify outbound 465 with `curl -v telnet://smtp.gmail.com:465`. |
| `EAUTH` with `Application-specific password required` | Used the regular Gmail password instead of an app password. | Generate the app password per §7.1 step 2. |

---

## 8. Quick reference: contact points

| What | Where |
| - | - |
| Production SSH | `ssh -i aliyun-cn-hk-zhufengyue.pem root@47.86.216.211` |
| Aliyun ECS console | `cn-hongkong` region |
| Aliyun RDS console | `cn-shenzhen`, instance `rm-wz9dt44hys36z7u1y0o` |
| DNS / TLS | Cloudflare zone `sinostatistica.net` |
| Public site | <http://www.sinostatistica.net/> (HTTP), HTTPS pending §6 |
| Chrome extension repo | `casinoMalwareExtension/` (sibling dir) |
