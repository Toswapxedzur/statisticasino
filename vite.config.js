import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env into process.env so the WS gateway's db.js (which falls back
// to process.env outside the SvelteKit module graph) can connect during
// dev. SvelteKit's own code still reads $env/* as usual; this only
// backfills process.env for our plain-node gateway. Never overrides a
// var already set in the real environment.
function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Dev/preview plugin: attach the poker WebSocket gateway to Vite's own
// HTTP server so `npm run dev` serves both the app and /ws. In prod the
// same attachPokerGateway() runs from server.js instead.
//
// The gateway serves ALL realtime (poker tables AND chat/presence/typing),
// and it only attaches once this process holds the single-instance poker
// lease — so a second local process (a stale/crashed server, a second
// `npm run dev`, a `node server.js`) that already holds the lease would
// otherwise leave this dev server with NO /ws and every realtime feature
// silently dead. Two guards against that failure mode:
//   1. Loud logging on BOTH paths, so the boot log always says whether
//      /ws attached ("realtime enabled") or not ("realtime DISABLED").
//   2. A background retry: if the lease is held elsewhere at boot we do
//      NOT latch off — we re-attempt every few seconds and attach /ws the
//      moment the lease frees, instead of staying broken until a restart.
const LEASE_RETRY_MS = 5000;
let _devPokerEnabled = false;
let _wsAttached = false;
let _leaseRetryTimer = null;
let _leaseRetries = 0;
function pokerWebSocket() {
  // Attach the /ws gateway exactly once (idempotent — the gateway itself
  // also guards against double-attach on HMR).
  const attachGatewayOnce = async (httpServer) => {
    if (_wsAttached || !_devPokerEnabled) return;
    const { attachPokerGateway } = await import("./src/lib/server/poker/gateway.js");
    attachPokerGateway(httpServer);
    _wsAttached = true;
    console.log("[bluffing-valley] realtime ENABLED — /ws attached (poker + chat + presence live)");
  };

  // Try to become the poker singleton. Returns true once we hold the lease.
  const tryAcquireLease = async (httpServer) => {
    const bank = await import("./src/lib/server/poker/bank.js");
    _devPokerEnabled = await bank.acquireInstanceLease((e) => {
      // Lease connection died unexpectedly: poker authority is gone. Warn
      // loudly and re-arm the retry so /ws re-attaches when we re-acquire.
      _devPokerEnabled = false;
      _wsAttached = false;
      console.error("[bluffing-valley] ⚠ lost the poker lease — realtime authority gone:", e?.message || e);
      scheduleLeaseRetry(httpServer);
    });
    if (!_devPokerEnabled) return false;
    const r = await bank.reconcileEscrowOnBoot();
    if (!r.skipped && r.seats > 0) console.log(`[bluffing-valley] escrow reconcile: refunded ${r.chips} chips across ${r.seats} seat(s)`);
    await attachGatewayOnce(httpServer);
    return true;
  };

  // Background retry loop (unref'd so it never keeps the process alive).
  function scheduleLeaseRetry(httpServer) {
    if (_leaseRetryTimer || _devPokerEnabled) return;
    _leaseRetryTimer = setInterval(async () => {
      try {
        if (await tryAcquireLease(httpServer)) {
          clearInterval(_leaseRetryTimer); _leaseRetryTimer = null;
          console.log(`[bluffing-valley] poker lease acquired after ${_leaseRetries} retr${_leaseRetries === 1 ? "y" : "ies"} — realtime is back up.`);
        } else if (++_leaseRetries % 6 === 0) {
          // Remind every ~30s so the operator knows why realtime is off.
          console.warn(`[bluffing-valley] still waiting on the poker lease (${_leaseRetries} tries) — stop the other local process to enable realtime.`);
        }
      } catch (err) {
        console.error("[bluffing-valley] lease retry error:", err?.message || err);
      }
    }, LEASE_RETRY_MS);
    _leaseRetryTimer.unref?.();
  }

  const attach = async (server) => {
    if (!server?.httpServer) return;
    if (_wsAttached) return; // already up (e.g. HMR re-run of configureServer)
    loadDotEnv();
    // Resolve the EFFECTIVE db host the way db.js does — DATABASE_URL wins
    // over MYSQL_HOST — and require an EXACT loopback match, so a prod
    // DATABASE_URL with a stale MYSQL_HOST=127.0.0.1 can't be reconciled here.
    let host = "";
    if (process.env.DATABASE_URL) {
      try { host = new URL(process.env.DATABASE_URL).hostname; }
      catch { host = "(unparseable DATABASE_URL)"; }
    } else {
      host = process.env.MYSQL_HOST || "";
    }
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!isLocal) {
      // NEVER touch a non-local DB from a dev server: reconcile refunds/clears
      // escrow and closes ephemeral tables — that would corrupt a live prod room.
      console.warn(`[bluffing-valley] realtime DISABLED — refusing to attach /ws against non-local DB host (${host || "unset"}).`);
      return;
    }
    // Release the poker lease when THIS server closes. Vite restarts in-process
    // on a config change: it closes this httpServer but does NOT close our
    // lease's MySQL connection, so the orphan keeps holding GET_LOCK and the
    // NEXT incarnation can't acquire the lease — it then comes up with /ws
    // detached (a self-deadlock; this was the original "dev realtime silently
    // dead after a restart" bug). Handing the lock back on close lets the next
    // incarnation take it cleanly (its retry loop picks it up within seconds).
    {
      const bank = await import("./src/lib/server/poker/bank.js");
      server.httpServer.once("close", () => {
        if (_leaseRetryTimer) { clearInterval(_leaseRetryTimer); _leaseRetryTimer = null; }
        Promise.resolve(bank.releaseInstanceLease?.()).catch(() => {});
      });
    }
    try {
      if (!(await tryAcquireLease(server.httpServer))) {
        console.warn("[bluffing-valley] ⚠ realtime DISABLED — another local process holds the poker lease; /ws NOT attached (chat/presence/tables are off). Auto-retrying every 5s — stop the other process to recover.");
        scheduleLeaseRetry(server.httpServer);
      }
    } catch (err) {
      console.error("[bluffing-valley] poker bootstrap error — /ws not attached, will retry:", err?.message || err);
      scheduleLeaseRetry(server.httpServer);
    }
  };
  return {
    name: "poker-websocket-dev",
    configureServer: attach,
    configurePreviewServer: attach
  };
}

export default defineConfig({
  plugins: [sveltekit(), pokerWebSocket()],
  // mysql2 is a pure-JS driver, no native bits to externalise.
  // Default Vite port (5173) collides with the user's other local
  // service. 5273 is well outside the common dev-port band; strictPort
  // makes Vite fail fast instead of silently jumping to 5274/5275 if
  // it's ever taken — which would defeat the point of pinning it.
  server: { port: 5273, strictPort: true }
});
