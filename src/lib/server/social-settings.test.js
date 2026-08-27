import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOCIAL_DEFAULTS,
  parseSocialSettings,
  serializeSocialSettings,
} from "./social-settings.js";

test("parseSocialSettings: null/empty → all defaults (everything on)", () => {
  assert.deepEqual(parseSocialSettings(null), { ...SOCIAL_DEFAULTS });
  assert.deepEqual(parseSocialSettings(""), { ...SOCIAL_DEFAULTS });
  assert.equal(parseSocialSettings(undefined).readReceipts, true);
  assert.equal(parseSocialSettings(undefined).typing, true);
});

test("parseSocialSettings: merges stored booleans over defaults", () => {
  const s = parseSocialSettings(JSON.stringify({ readReceipts: false, typing: false }));
  assert.equal(s.readReceipts, false);
  assert.equal(s.typing, false);
  // untouched keys keep their default
  assert.equal(s.allowGroupAdd, true);
  assert.equal(s.notifyMessages, true);
});

test("parseSocialSettings: ignores non-boolean / unknown keys", () => {
  const s = parseSocialSettings(JSON.stringify({ typing: "nope", bogus: 1, readReceipts: 0 }));
  assert.equal(s.typing, true);        // string ignored → default
  assert.equal(s.readReceipts, true);  // 0 is not a boolean → default
  assert.equal("bogus" in s, false);   // unknown key not carried through
});

test("parseSocialSettings: malformed JSON falls back to defaults", () => {
  assert.deepEqual(parseSocialSettings("{not json"), { ...SOCIAL_DEFAULTS });
});

test("parseSocialSettings: accepts an already-parsed object", () => {
  const s = parseSocialSettings({ readReceipts: false });
  assert.equal(s.readReceipts, false);
  assert.equal(s.typing, true);
});

test("serializeSocialSettings: emits exactly the known keys as booleans", () => {
  const json = serializeSocialSettings({ readReceipts: false, typing: 1, extra: true });
  const obj = JSON.parse(json);
  assert.deepEqual(Object.keys(obj).sort(), Object.keys(SOCIAL_DEFAULTS).sort());
  assert.equal(obj.readReceipts, false);
  assert.equal(obj.typing, true);   // coerced from truthy
  assert.equal("extra" in obj, false);
});

test("serialize → parse round-trips", () => {
  const original = { ...SOCIAL_DEFAULTS, readReceipts: false, notifyTransfers: false };
  assert.deepEqual(parseSocialSettings(serializeSocialSettings(original)), original);
});
