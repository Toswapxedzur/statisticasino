// Voice ICE configuration. The browser needs STUN (to discover its public
// address) and, for the ~10–20% of peers that can't connect directly, a TURN
// relay. We run our OWN coturn (see DEPLOYMENT.md §voice), authenticated with a
// shared secret via coturn's `use-auth-secret` (a.k.a. the TURN REST API):
//
//   username   = <unix-expiry>            (a short-lived timestamp)
//   credential = base64(HMAC-SHA1(secret, username))
//
// The credential is derived FROM the secret but the secret itself never leaves
// the server — the browser only ever receives an expiring username/password pair.
//
// Env:
//   TURN_URL     e.g. "turn:47.243.163.51:3478?transport=udp"  (coturn)
//   TURN_SECRET  the coturn static-auth-secret (server-only)
//   TURN_TTL     credential lifetime in seconds (default 3600)
// With no TURN_URL configured (e.g. local dev) we fall back to a public STUN
// server so direct P2P still works; only relayed connections need TURN.

import { createHmac } from "node:crypto";

const DEFAULT_TTL = 3600;
const PUBLIC_STUN = "stun:stun.l.google.com:19302";

// `now` is injectable for tests. Returns { iceServers: [...] } for RTCPeerConnection.
export function iceConfig(env = process.env, now = Date.now) {
  const turnUrl = env.TURN_URL;
  const secret = env.TURN_SECRET;

  if (!turnUrl || !secret) {
    return { iceServers: [{ urls: PUBLIC_STUN }] };
  }

  const ttl = Number(env.TURN_TTL) > 0 ? Number(env.TURN_TTL) : DEFAULT_TTL;
  const username = String(Math.floor(now() / 1000) + ttl);
  const credential = createHmac("sha1", secret).update(username).digest("base64");

  // Point STUN at our coturn too (coturn is a STUN server as well) so there's no
  // third-party dependency once TURN is configured. Derive the stun: host from the
  // turn: URL (strip scheme + any ?transport query).
  const hostPort = turnUrl.replace(/^turns?:/, "").split("?")[0];
  return {
    iceServers: [
      { urls: `stun:${hostPort}` },
      { urls: turnUrl, username, credential }
    ]
  };
}
