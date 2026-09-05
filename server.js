// Production entry point — replaces `node build`.
//
// adapter-node's `build/handler.js` is a bare request handler; on its own
// (`node build`) it can't also run a WebSocket server. So we create the
// http.Server ourselves, mount the SvelteKit handler for normal requests,
// and attach the poker WS gateway for `/ws` upgrades on the SAME port.
// nginx already proxies Upgrade/Connection, so this works behind the
// existing reverse proxy unchanged.
//
// Run in prod with:  node server.js   (see DEPLOYMENT.md)
// systemd ExecStart should point here instead of at build/.

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Local convenience: if a .env sits next to this file (dev boxes running
// `node server.js` after a build), load it. In real prod, systemd's
// EnvironmentFile already populates process.env and this is a no-op
// (existing vars are never overridden).
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { handler } = await import("./build/handler.js");
const { attachPokerGateway } = await import("./src/lib/server/poker/gateway.js");
const { hub } = await import("./src/lib/server/poker/hub.js");
const { ensureMigrated } = await import("./src/lib/server/migrate.js");
const { reconcileEscrowOnBoot, acquireInstanceLease, releaseInstanceLease } =
  await import("./src/lib/server/poker/bank.js");

// Schema first — the whole app needs it, and it's idempotent.
try { await ensureMigrated(); } catch (err) {
  console.error("[bluffing-valley] migration error:", err?.message || err);
}

// Media janitor: sweep expired chat attachments from OSS on a timer. No-op until
// OSS is configured (env) + activated — see media.js.
try {
  const { startMediaJanitor, ossAvailable } = await import("./src/lib/server/media.js");
  startMediaJanitor();
  if (ossAvailable()) console.log("[bluffing-valley] media (OSS) enabled");
} catch (err) { console.error("[bluffing-valley] media janitor init:", err?.message || err); }

// Become the sole poker instance for this DB before touching escrow. If another
// live process already holds the lease (a botched rolling deploy, or a dev
// server on the same DB), we do NOT reconcile — that would refund chips the
// other process still holds live — and we do NOT attach the poker gateway. The
// rest of the site (data/blog/account) still serves.
let pokerEnabled = false;

// Fail-stop if we ever lose the lease connection: exiting lets systemd
// restart us clean and prevents a split brain (another process reconciling
// our live escrow). Guard so the drain can finish if a shutdown is underway.
function onLeaseLost(e) {
  if (shuttingDown) return;
  console.error("[bluffing-valley] lost the poker singleton lease — exiting to avoid split-brain; supervisor will restart:", e?.message || e);
  process.exit(1);
}

// Try to become the sole poker instance and run crash recovery. Returns true
// when poker may be enabled. Never throws.
async function tryEnablePoker() {
  try {
    const got = await acquireInstanceLease(onLeaseLost);
    if (!got) {
      console.error("[bluffing-valley] another poker instance holds the DB lease — serving HTTP only for now (poker + escrow reconcile disabled); will retry.");
      return false;
    }
    // Crash recovery: refund on-table escrow left by an unclean prior exit
    // (SIGKILL/OOM/power loss; a graceful stop drains seats itself).
    const r = await reconcileEscrowOnBoot();
    if (r.skipped) {
      console.warn(`[bluffing-valley] escrow reconcile skipped: ${r.reason}`);
    } else {
      if (r.seats > 0) console.log(`[bluffing-valley] escrow reconcile: refunded ${r.chips} chips across ${r.seats} seat(s)`);
      if (r.failed > 0) console.error(`[bluffing-valley] escrow reconcile: ${r.failed} row(s) could not be refunded and remain pending — will retry next boot`);
    }
    return true;
  } catch (err) {
    // e.g. MySQL is mid-restart (unattended-upgrades bounces it and systemd
    // relaunches us 2s later, often before the DB is back). Retry below.
    console.error("[bluffing-valley] instance lease / escrow reconcile error — serving HTTP only for now; will retry:", err?.message || err);
    return false;
  }
}

pokerEnabled = await tryEnablePoker();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const server = http.createServer((req, res) => handler(req, res));
if (pokerEnabled) attachPokerGateway(server);

server.listen(port, host, () => {
  console.log(`[bluffing-valley] ${pokerEnabled ? "http + ws" : "http only (poker disabled)"} listening on ${host}:${port}`);
});

// Self-heal a degraded boot: if the lease wasn't acquired (DB mid-restart, or a
// previous holder still draining), keep retrying and attach the poker gateway
// once we win it. Before this, one bad race at boot meant "http only" FOREVER
// (seen 2026-09-01 → 09-03 in prod).
if (!pokerEnabled) {
  const RETRY_MS = 30_000;
  const retry = setInterval(async () => {
    if (shuttingDown || pokerEnabled) { clearInterval(retry); return; }
    if (await tryEnablePoker()) {
      pokerEnabled = true;
      clearInterval(retry);
      attachPokerGateway(server);
      console.log("[bluffing-valley] poker singleton lease acquired on retry — ws gateway attached (http + ws now live)");
    }
  }, RETRY_MS);
  retry.unref?.();
}

let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (shuttingDown) return; // ignore a second signal while draining
    shuttingDown = true;
    // Refund every seated player's chips to their wallet, then hand the DB
    // lease to the next process, before exiting (see DEPLOYMENT.md).
    try { await hub.shutdown(); } catch { /* best effort */ }
    try { await releaseInstanceLease(); } catch { /* best effort */ }
    server.close(() => process.exit(0));
    // Don't wait forever if sockets linger.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
