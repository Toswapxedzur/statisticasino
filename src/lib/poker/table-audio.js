// Table animation sounds — the owner's picks from the Sound Lab (static/sfx/table, see LICENSE.txt
// there), each on the exact moment of its motion.
//
// The dealer (cards) and the coin engine announce every landing as its flight starts — a cue
// { t, name, at?, count? } on the performance.now() clock, t = the frame it lands. This player
// schedules the sound on the Web Audio clock (a look-ahead scheduler, like the Sound Lab), started
// early by the clip's LEAD (table-sounds.json: ms from the file's start to its main hit) so the hit
// itself lands on that frame. A cue that arrives late skips into its lead, so the hit is still on time.
// Sounds that aren't tied to a motion (join, turn, win…) stay in $lib/sfx.js.
import { browser, version } from "$app/environment";
import LEADS from "./table-sounds.json";
import { soundEnabled, sfxUnlocked } from "$lib/sfx.js";

const coins = (tier) => [1, 2, 3].map((i) => `coin-${tier}-${i}`);
/** name → files (rotated) + gain. onHit: the cue's time is the impact, so start early by the lead. */
export const TABLE_SOUNDS = {
  cardLand: { files: ["card-deal"], gain: 0.9, onHit: true },  // a card lands on a seat / the board
  flip:     { files: ["card-flip"], gain: 0.6 },               // cards start to turn face-up
  pileTap:  { files: ["card-pile"], gain: 0.9, onHit: true },  // a card reaches the used pile: a fold, the collection
  cardPlay: { files: ["card-play"], gain: 0.9, onHit: true },  // a card played onto the centre pile (shedding games)
  riffle:   { files: ["riffle"], gain: 0.45 },                 // the shuffle (trimmed to its length)
  coins:    { tiers: { one: coins("one"), few: coins("few"), pile: coins("pile") }, gain: 0.8, onHit: true },
  pot:      { files: coins("pile"), gain: 0.9, onHit: true },  // the piles land in the pot
  allIn:    { files: ["coin-allin"], gain: 1 }                 // a whole stack pushed (plays instead of its clicks)
};
/** Coin tier by how many coins land: 1 · 2–4 · 5+. */
export const coinTier = (count) => (count >= 5 ? "pile" : count >= 2 ? "few" : "one");

/** The coin engine's cues (coin-motion.js CUES) → table sounds. Starts of motion stay silent. */
export function moneySound(cue) {
  switch (cue.name) {
    case "coins": return { name: "coins", count: cue.count };
    case "allIn": return { name: "allIn" };
    case "pot": return { name: "pot" };
    case "sink": return { name: "coins", count: cue.count || 1 };           // winnings into the badge
    case "merge": return { name: "coins", count: 1, gain: 0.5 };            // a carry: a soft click
    case "break": return { name: "coins", count: cue.count || 1, gain: 0.5 };
    default: return null;                                                    // bet / sweep / collect / check
  }
}

// ------------------------------------------------------------------ the audio engine (one per page)
const LOOKAHEAD = 120;   // ms of sound handed to the audio clock ahead of time
const STALE = 250;       // a cue this late (a hidden tab) is dropped
let ctx = null, master = null, loading = null, _ext = null;
const buffers = new Map();   // file → AudioBuffer
const rot = new Map();       // file list → next index
const lastHit = new Map();   // name → last hit time (two within 22 ms: one sound)

function ext() {
  if (_ext) return _ext;
  _ext = document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  return _ext;
}
function load() {
  if (loading) return loading;
  const files = new Set();
  for (const d of Object.values(TABLE_SOUNDS)) for (const f of d.files || Object.values(d.tiers).flat()) files.add(f);
  loading = Promise.all([...files].map(async (f) => {
    try {
      const res = await fetch(`/sfx/table/${f}.${ext()}?v=${version}`);
      buffers.set(f, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch { /* a missing clip plays nothing */ }
  }));
  return loading;
}
/** The audio context, created on the first gesture (browsers keep it silent until one) — or at once
 *  when the visit already had one (arriving at a table from the lobby's Quick Play). */
function audio() {
  if (!browser) return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = ctx.createGain();
    master.connect(ctx.destination);
    load();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
const hadGesture = () => (browser ? navigator.userActivation?.hasBeenActive ?? sfxUnlocked() : false);
if (browser) {
  if (hadGesture()) audio();
  const unlock = () => { audio(); window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true); };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/**
 * Start `name` so that its hit (or its start, for sounds without one) is at `perfT`
 * (performance.now() clock). opts: x 0..1 across the screen (pan), gain, count (coin tier),
 * dur (trim, ms), noLead (play from the file's start at perfT — no motion to land on).
 */
function start(name, perfT, { x = 0.5, gain = 1, count = 1, dur = null, noLead = false } = {}) {
  const def = TABLE_SOUNDS[name];
  if (!def || !ctx || ctx.state !== "running") return false;
  const list = def.tiers ? def.tiers[coinTier(count)] : def.files;
  const key = list.join("|"), i = rot.get(key) ?? Math.floor(Math.random() * list.length);
  rot.set(key, i + 1);
  const file = list[i % list.length], buf = buffers.get(file);
  if (!buf) return false;
  const hit = ctx.currentTime + (perfT - performance.now()) / 1000;
  if (hit - (lastHit.get(name) ?? -1) < 0.022) return false;
  lastHit.set(name, hit);
  const lead = def.onHit && !noLead ? (LEADS[file]?.[ext()] ?? 0) / 1000 : 0;
  let when = hit - lead, offset = 0;
  if (when < ctx.currentTime) { offset = Math.min(ctx.currentTime - when, lead); when = ctx.currentTime; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = def.gain * gain;
  let out = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, (x * 2 - 1) * 0.4));
    g.connect(p); out = p;
  }
  src.connect(g);
  out.connect(master);
  if (dur) {
    const end = when + dur / 1000;
    g.gain.setValueAtTime(g.gain.value, Math.max(when, end - 0.18));
    g.gain.linearRampToValueAtTime(0.0001, end);
    src.start(when, offset); src.stop(end + 0.02);
  } else src.start(when, offset);
  return true;
}

/** Where a cue happens, 0..1 across the window (for the pan). */
function placeOf(at) {
  if (!browser || !at) return 0.5;
  if (at.kind === "deck") return 0.03;
  if (at.kind === "used") return 0.97;
  let el = null;
  const seat = at.seat ?? (typeof at.pile === "string" && at.pile.startsWith("bet:") ? at.pile.slice(4) : null);
  if (seat === "house") el = document.querySelector("[data-house]");
  else if (seat != null) el = document.querySelector(`[data-seat="${seat}"]`);
  if (!el) return 0.5;
  const r = el.getBoundingClientRect();
  return Math.max(0, Math.min(1, (r.left + r.width / 2) / (window.innerWidth || 1)));
}

// ------------------------------------------------------------------ the scheduler (one per table)
export class TableSounds {
  constructor() { this.pending = []; }   // { t, name, at?, count?, gain?, dur?, noLead? }, sorted by start

  /** Take the dealer's / the coin engine's new cues (their arrays are emptied). */
  take(cues, map = (c) => c) {
    if (!cues?.length) return;
    for (const c of cues.splice(0)) {
      const s = map(c);
      if (s && TABLE_SOUNDS[s.name]) this.pending.push({ ...c, ...s, t: c.t });
    }
  }
  /** A sound with no motion behind it (a view change on a table without the animation). */
  now(name, { delay = 0, count = 1, gap = 0, volume = 1, dur = null, burst = 1 } = {}) {
    const t = performance.now() + delay;
    for (let k = 0; k < burst; k++) this.pending.push({ t: t + k * gap, name, count, gain: volume, dur, noLead: true });
  }
  clear() { this.pending = []; }

  /** Every frame: hand the audio clock whatever starts within the look-ahead. */
  frame(t = performance.now()) {
    if (!this.pending.length) return;
    if (!ctx && hadGesture()) audio();
    if (!soundEnabled() || !ctx || ctx.state !== "running") { this.pending = this.pending.filter((c) => c.t > t); return; }
    const keep = [];
    for (const c of this.pending) {
      const def = TABLE_SOUNDS[c.name];
      const lead = def.onHit && !c.noLead ? 700 : 0;          // (a generous upper bound on any clip's lead)
      if (c.t < t - STALE) continue;
      if (c.t - lead > t + LOOKAHEAD) { keep.push(c); continue; }
      start(c.name, c.t, { x: placeOf(c.at), gain: c.gain ?? 1, count: c.count ?? 1, dur: c.dur, noLead: c.noLead });
    }
    this.pending = keep;
  }
}
