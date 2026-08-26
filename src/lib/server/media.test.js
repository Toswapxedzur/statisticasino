// Media: OSS V1 URL signing is deterministic, and the whole layer is gated off
// when OSS isn't configured. No network / no MySQL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { signUrl, ossConfig, ossAvailable, createUpload } from "./media.js";

const CFG = { bucket: "riverside-media", endpoint: "oss-cn-hongkong.aliyuncs.com", id: "AKID", secret: "SECRET" };

test("signUrl is deterministic + well-formed", () => {
  const u = signUrl("GET", "avatars/abc.png", 1_800_000_000, "", CFG);
  assert.match(u, /^https:\/\/riverside-media\.oss-cn-hongkong\.aliyuncs\.com\/avatars\/abc\.png\?/);
  assert.match(u, /OSSAccessKeyId=AKID/);
  assert.match(u, /Expires=1800000000/);
  assert.match(u, /Signature=/);
  // stable across calls
  assert.equal(u, signUrl("GET", "avatars/abc.png", 1_800_000_000, "", CFG));
  // different method -> different signature
  assert.notEqual(u, signUrl("PUT", "avatars/abc.png", 1_800_000_000, "image/png", CFG));
});

test("gated off without OSS env", () => {
  const saved = { ...process.env };
  delete process.env.OSS_BUCKET; delete process.env.OSS_ENDPOINT;
  delete process.env.OSS_ACCESS_KEY_ID; delete process.env.OSS_ACCESS_KEY_SECRET;
  assert.equal(ossConfig(), null);
  assert.equal(ossAvailable(), false);
  Object.assign(process.env, saved);
});

test("createUpload refuses when OSS unavailable", async () => {
  const res = await createUpload({ uploaderId: "u", kind: "avatar", mime: "image/png", bytes: 1000 }, { execute: async () => {} });
  assert.equal(res.error, "media_unavailable");
});
