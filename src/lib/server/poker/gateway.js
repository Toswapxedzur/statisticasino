// WebSocket gateway. Attaches a ws server (in `noServer` mode) to an
// existing Node http.Server and bridges each socket to the PokerHub.
//
// Used from two places with the same signature:
//   * Vite dev  — a plugin calls attachPokerGateway(server.httpServer).
//   * Prod      — server.js calls attachPokerGateway(httpServer) on the
//                 http server that also serves the SvelteKit handler.
//
// Auth: the upgrade request carries the browser's cookies, so we parse
// the `casino_session` cookie and validate it exactly like hooks.server.js
// does for HTTP. Anonymous sockets are allowed (they can watch the lobby
// and tables) but can't take a seat — the hub enforces that.
//
// Plain-node-ESM clean (no SvelteKit `$` imports) so it runs in prod.

import { WebSocketServer } from "ws";
import { validateSessionToken } from "../auth.js";
import { SESSION_COOKIE } from "../cookies.js";
import { encode, S2C } from "../../poker/protocol.js";
import { hub } from "./hub.js";
import { startScheduler } from "../sprint-scheduler.js";
import { makeSprintRunner } from "./sprint-pool.js";

const WS_PATH = "/ws";
const HEARTBEAT_MS = 30_000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

let _attached = false;
let _schedulerStarted = false;

// Start the River Sprint scheduler exactly once, on the instance that holds the
// WS gateway (i.e. the poker lease). It creates the day's rounds and runs each
// one through the fast-fold pool at its scheduled time.
function startSprintSchedulerOnce() {
  if (_schedulerStarted) return;
  _schedulerStarted = true;
  try { startScheduler(makeSprintRunner(hub)); }
  catch (e) { console.error("[bluffing-valley] sprint scheduler failed to start:", e?.message || e); }
}

export function attachPokerGateway(httpServer, { path = WS_PATH } = {}) {
  // Guard against double-attach (Vite can re-run config on HMR).
  if (httpServer.__pokerGatewayAttached__) return;
  httpServer.__pokerGatewayAttached__ = true;
  _attached = true;
  startSprintSchedulerOnce();

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== path) return; // let other upgrade handlers (Vite HMR) have it

    // Authenticate BEFORE completing the handshake so the socket is born
    // knowing who it is.
    let user = null;
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE] || null;
      if (token) {
        const res = await validateSessionToken(token);
        user = res.user; // null if invalid/expired
      }
    } catch {
      user = null;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, user);
    });
  });

  wss.on("connection", (ws, req, user) => {
    const conn = {
      ws,
      user,                 // {id, email, displayName, isAdmin} or null
      alive: true,
      watching: new Set(),
      send(data) {
        if (ws.readyState === ws.OPEN) {
          try { ws.send(data); } catch { /* socket went away */ }
        }
      }
    };
    ws.__conn = conn;

    hub.addConnection(conn);
    conn.send(encode(S2C.HELLO_OK, {
      user: user
        ? { id: user.id, name: user.displayName || user.email, isAdmin: user.isAdmin }
        : null
    }));

    ws.on("message", (data) => {
      // ws gives a Buffer; cap message size defensively.
      const raw = data.toString("utf8");
      if (raw.length > 8192) return;
      hub.handleMessage(conn, raw);
    });

    ws.on("pong", () => { conn.alive = true; });
    ws.on("close", () => hub.removeConnection(conn));
    ws.on("error", () => { try { ws.close(); } catch { /* noop */ } });
  });

  // Heartbeat: terminate sockets that stopped answering pings.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      const conn = ws.__conn;
      if (conn && conn.alive === false) {
        try { ws.terminate(); } catch { /* noop */ }
        continue;
      }
      if (conn) conn.alive = false;
      try { ws.ping(); } catch { /* noop */ }
    }
  }, HEARTBEAT_MS);
  beat.unref?.();

  wss.on("close", () => clearInterval(beat));
  return wss;
}

export function isGatewayAttached() {
  return _attached;
}
