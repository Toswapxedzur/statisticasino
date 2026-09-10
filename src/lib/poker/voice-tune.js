// Pure helpers for the table voice mesh (kept free of browser/runtime imports so they're testable).

// Opus settings for lossy links: in-band FEC (recover single lost packets), DTX
// (send nothing while silent), a 32 kbps ceiling so a weak uplink isn't saturated.
const OPUS_FMTP = "minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=32000;stereo=0;sprop-stereo=0";
export function tuneOpusSdp(sdp) {
  if (typeof sdp !== "string") return sdp;
  const lines = sdp.split("\r\n");
  const pts = lines.filter((l) => /^a=rtpmap:\d+ opus\//i.test(l)).map((l) => l.match(/^a=rtpmap:(\d+)/)[1]);
  if (!pts.length) return sdp;
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    const m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (m && pts.includes(m[1])) {
      seen.add(m[1]);
      const params = new Map();
      for (const kv of m[2].split(";")) { const t = kv.trim(); if (!t) continue; const i = t.indexOf("="); params.set(i < 0 ? t : t.slice(0, i), i < 0 ? "" : t.slice(i + 1)); }
      for (const kv of OPUS_FMTP.split(";")) { const [k, v] = kv.split("="); params.set(k, v); }
      out.push(`a=fmtp:${m[1]} ` + [...params].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(";"));
    } else out.push(l);
  }
  for (const pt of pts) {
    if (seen.has(pt)) continue;
    const i = out.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
    out.splice(i + 1, 0, `a=fmtp:${pt} ${OPUS_FMTP}`);
  }
  return out.join("\r\n");
}

// Recovery schedule for a peer that dropped: how long to give each attempt before
// escalating. Attempt 1 = ICE restart on the same connection; 2 = rebuild through
// the TURN relay only; later = rebuild with everything allowed, backing off.
export const RECOVERY_WAIT_MS = [10000, 15000, 20000, 30000, 30000];
export const MAX_RECOVERY_ATTEMPTS = RECOVERY_WAIT_MS.length;
// A "disconnected" blip often heals itself; only act if it persists this long.
export const DISCONNECT_GRACE_MS = 3000;
