import { test } from "node:test";
import assert from "node:assert/strict";
import { tuneOpusSdp, RECOVERY_WAIT_MS, MAX_RECOVERY_ATTEMPTS, DISCONNECT_GRACE_MS } from "./voice-tune.js";

const SDP = [
  "v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=-", "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=rtpmap:9 G722/8000",
  ""
].join("\r\n");

test("tuneOpusSdp adds FEC/DTX/bitrate to the existing opus fmtp line", () => {
  const out = tuneOpusSdp(SDP);
  const fmtp = out.split("\r\n").find((l) => l.startsWith("a=fmtp:111 "));
  assert.match(fmtp, /useinbandfec=1/);
  assert.match(fmtp, /usedtx=1/);
  assert.match(fmtp, /maxaveragebitrate=32000/);
  assert.match(fmtp, /stereo=0/);
  assert.equal(out.split("\r\n").filter((l) => l.startsWith("a=fmtp:111")).length, 1, "no duplicate fmtp");
  assert.ok(out.includes("a=rtpmap:9 G722/8000"), "other codecs untouched");
});

test("tuneOpusSdp inserts an fmtp line when opus had none", () => {
  const sdp = SDP.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "");
  const lines = tuneOpusSdp(sdp).split("\r\n");
  const i = lines.indexOf("a=rtpmap:111 opus/48000/2");
  assert.match(lines[i + 1], /^a=fmtp:111 .*usedtx=1/);
});

test("tuneOpusSdp is a no-op without opus or for non-strings", () => {
  const sdp = "v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n";
  assert.equal(tuneOpusSdp(sdp), sdp);
  assert.equal(tuneOpusSdp(undefined), undefined);
});

test("recovery schedule: restart first, escalate with backoff, bounded", () => {
  assert.equal(MAX_RECOVERY_ATTEMPTS, RECOVERY_WAIT_MS.length);
  assert.ok(MAX_RECOVERY_ATTEMPTS >= 3);
  for (let i = 1; i < RECOVERY_WAIT_MS.length; i++) assert.ok(RECOVERY_WAIT_MS[i] >= RECOVERY_WAIT_MS[i - 1]);
  assert.ok(DISCONNECT_GRACE_MS >= 1000 && DISCONNECT_GRACE_MS < RECOVERY_WAIT_MS[0]);
});
