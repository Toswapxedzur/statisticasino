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
let _devBootstrapped = false;
let _devPokerEnabled = false;
function pokerWebSocket() {
  const attach = async (server) => {
    if (!server?.httpServer) return;
    loadDotEnv();
    // One-time dev bootstrap: take the instance lease, then crash-recover
    // escrow — same discipline as prod server.js, so two dev/preview processes
    // on one DB can't both serve poker or double-refund.
    if (!_devBootstrapped) {
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
        console.warn(`[riverside] dev poker disabled: non-local DB host (${host || "unset"})`);
        _devBootstrapped = true;
      } else {
        try {
          const bank = await import("./src/lib/server/poker/bank.js");
          _devPokerEnabled = await bank.acquireInstanceLease((e) => {
            _devPokerEnabled = false;
            console.error("[riverside] dev lost the poker lease:", e?.message || e);
          });
          if (!_devPokerEnabled) {
            console.warn("[riverside] another local process holds the poker lease — dev serving without poker.");
          } else {
            const r = await bank.reconcileEscrowOnBoot();
            if (!r.skipped && r.seats > 0) console.log(`[riverside] escrow reconcile: refunded ${r.chips} chips across ${r.seats} seat(s)`);
          }
          _devBootstrapped = true; // only after success, so a failure retries on the next attach
        } catch (err) {
          console.error("[riverside] dev poker bootstrap error (will retry):", err?.message || err);
        }
      }
    }
    if (_devPokerEnabled) {
      const { attachPokerGateway } = await import("./src/lib/server/poker/gateway.js");
      attachPokerGateway(server.httpServer);
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
