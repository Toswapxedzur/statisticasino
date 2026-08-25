// Voice ICE config: STUN-only fallback with no TURN, and ephemeral coturn creds
// (HMAC-SHA1 of an expiry timestamp) when TURN is configured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iceConfig } from "./voice.js";

test("no TURN configured → a STUN-only config", () => {
  const cfg = iceConfig({});
  assert.equal(cfg.iceServers.length, 1);
  assert.match(cfg.iceServers[0].urls, /^stun:/);
});

test("with TURN configured → STUN on our host + TURN with ephemeral creds", () => {
  const env = { TURN_URL: "turn:1.2.3.4:3478?transport=udp", TURN_SECRET: "s3cret", TURN_TTL: "600" };
  const now = () => 1_000_000_000_000; // fixed
  const cfg = iceConfig(env, now);
  const [stun, turn] = cfg.iceServers;
  assert.equal(stun.urls, "stun:1.2.3.4:3478", "STUN points at our coturn host (no ?transport)");
  assert.equal(turn.urls, env.TURN_URL);
  // username = unix-now + ttl; credential = base64(HMAC-SHA1(secret, username)).
  const expectedUser = String(Math.floor(now() / 1000) + 600);
  assert.equal(turn.username, expectedUser);
  assert.equal(turn.credential, createHmac("sha1", "s3cret").update(expectedUser).digest("base64"));
});

test("the secret is never exposed to the client", () => {
  const cfg = iceConfig({ TURN_URL: "turn:1.2.3.4:3478", TURN_SECRET: "topsecret" }, () => 0);
  assert.ok(!JSON.stringify(cfg).includes("topsecret"), "raw secret must not appear in the config");
});
