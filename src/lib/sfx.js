// Table sound effects — Kenney CC0 clips in /static/sfx (see LICENSE.txt there).
//
// Design: one tiny module, no audio graph. Each named sound has 1..n variants
// (rotated so repeated deals/bets don't sound like a loop) and a base gain. The
// browser blocks playback until a user gesture, so play() silently no-ops until
// the first click/keypress "unlocks" audio. Preference lives client-side in
// localStorage ("bv-sound" = "on" | "off"), like the theme.
import { browser } from "$app/environment";

const KEY = "bv-sound";
const SOUNDS = {
  shuffle:  { files: ["shuffle"], gain: 0.5 },
  deal:     { files: ["deal-1", "deal-2", "deal-3", "deal-4"], gain: 0.7 },
  board:    { files: ["board-1", "board-2", "board-3", "board-4"], gain: 0.8 },
  showdown: { files: ["showdown"], gain: 0.8 },
  fold:     { files: ["fold-1", "fold-2"], gain: 0.7 },
  check:    { files: ["check"], gain: 0.6 },
  bet:      { files: ["bet-1", "bet-2", "bet-3"], gain: 0.8 },
  raise:    { files: ["raise-1", "raise-2", "raise-3"], gain: 0.9 },
  allin:    { files: ["allin"], gain: 1 },
  pot:      { files: ["pot"], gain: 0.8 },
  win:      { files: ["win"], gain: 0.6 },
  winChips: { files: ["win-chips"], gain: 0.9 },
  turn:     { files: ["turn"], gain: 0.8 },
  tick:     { files: ["tick"], gain: 0.6 },
  join:     { files: ["join"], gain: 0.5 },
  leave:    { files: ["leave"], gain: 0.5 },
  chat:     { files: ["chat"], gain: 0.5 },
  notify:   { files: ["notify"], gain: 0.6 },
  reward:   { files: ["reward"], gain: 0.7 },
  click:    { files: ["click"], gain: 0.4 },
  dice:     { files: ["dice-1", "dice-2", "dice-3"], gain: 0.9 },
  shake:    { files: ["shake-1", "shake-2"], gain: 0.7 },
  reel:     { files: ["reel-1", "reel-2", "reel-3"], gain: 0.7 },
  lose:     { files: ["lose"], gain: 0.7 },
  error:    { files: ["error"], gain: 0.6 },
  // --- app-wide UI ---
  select:   { files: ["select"], gain: 0.4 },        // tab / segmented selector change
  toggle:   { files: ["toggle"], gain: 0.5 },        // checkbox / switch / theme
  open:     { files: ["open"], gain: 0.5 },          // modal / menu / popover opens
  close:    { files: ["close"], gain: 0.5 },         // …closes
  confirm:  { files: ["confirm"], gain: 0.6 },       // form submit / accept / register
  back:     { files: ["back"], gain: 0.45 },         // cancel / decline / dismiss
  nav:      { files: ["nav"], gain: 0.35 },          // page navigation
  // --- social ---
  send:     { files: ["send"], gain: 0.5 },          // my message went out
  receive:  { files: ["receive"], gain: 0.6 },       // a message came in
  invite:   { files: ["invite"], gain: 0.7 },        // table invite
  friendReq:{ files: ["friend-req"], gain: 0.6 },
  friendOk: { files: ["friend-ok"], gain: 0.6 },
  transfer: { files: ["transfer"], gain: 0.8 },      // chips received from a friend
  coins:    { files: ["coins"], gain: 0.6 },         // wallet balance changed
  // --- voice / calls ---
  ring:     { files: ["ring"], gain: 0.7, loop: true },
  callOn:   { files: ["call-on"], gain: 0.6 },
  callOff:  { files: ["call-off"], gain: 0.6 },
  voiceIn:  { files: ["voice-in"], gain: 0.5 },
  voiceOut: { files: ["voice-out"], gain: 0.5 },
  // --- events ---
  fanfare:  { files: ["fanfare"], gain: 0.7 },       // Sprint round starts / tournament starts
  think:    { files: ["think-1", "think-2"], gain: 0.35 } // idle chip riffle while it's your turn
};

let _enabled = null;
let _unlocked = false;
let _ext = null;
const _cache = new Map();   // file -> HTMLAudioElement template
const _rot = new Map();     // name -> next variant index

function ext() {
  if (_ext) return _ext;
  const a = document.createElement("audio");
  _ext = a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  return _ext;
}

export function soundEnabled() {
  if (!browser) return false;
  if (_enabled == null) {
    try { _enabled = localStorage.getItem(KEY) !== "off"; } catch { _enabled = true; }
  }
  return _enabled;
}

export function setSoundEnabled(on) {
  _enabled = !!on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
  if (on) { _unlocked = true; play("click"); }
}

// Call once from the root layout: unlock on first gesture and warm the cache.
export function initSfx() {
  if (!browser) return;
  const unlock = () => {
    _unlocked = true;
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  // Warm the most common clips lazily (after paint) so the first deal isn't late.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  idle(() => { for (const n of ["deal", "board", "bet", "fold", "check", "turn", "pot"]) for (const f of SOUNDS[n].files) template(f); });
}

function template(file) {
  let a = _cache.get(file);
  if (!a) {
    a = new Audio(`/sfx/${file}.${ext()}`);
    a.preload = "auto";
    _cache.set(file, a);
  }
  return a;
}

// Play a named sound. `opts.volume` (0..1) scales the base gain; `opts.delay` ms.
export function play(name, opts = {}) {
  if (!browser || !_unlocked || !soundEnabled()) return;
  const def = SOUNDS[name];
  if (!def) return;
  const i = (_rot.get(name) ?? Math.floor(Math.random() * def.files.length)) % def.files.length;
  _rot.set(name, i + 1);
  const go = () => {
    try {
      const node = template(def.files[i]).cloneNode(true);
      node.volume = Math.max(0, Math.min(1, def.gain * (opts.volume ?? 1)));
      node.play().catch(() => { /* autoplay policy / decode failure: stay silent */ });
    } catch { /* never let audio break the table */ }
  };
  if (opts.delay) setTimeout(go, opts.delay); else go();
}

// Start a looping sound; returns { stop() }. Used for the incoming-call ring.
export function loop(name, opts = {}) {
  const def = SOUNDS[name];
  if (!browser || !def) return { stop() {} };
  let node = null, stopped = false;
  const start = () => {
    if (stopped || !_unlocked || !soundEnabled()) return;
    try {
      node = template(def.files[0]).cloneNode(true);
      node.loop = true;
      node.volume = Math.max(0, Math.min(1, def.gain * (opts.volume ?? 1)));
      node.play().catch(() => {});
    } catch { /* stay silent */ }
  };
  start();
  // If audio wasn't unlocked yet, start on the first gesture.
  const retry = () => { if (!node) start(); window.removeEventListener("pointerdown", retry, true); };
  if (!node) window.addEventListener("pointerdown", retry, true);
  return { stop() { stopped = true; window.removeEventListener("pointerdown", retry, true); try { node?.pause(); } catch {} node = null; } };
}

// App-wide UI sounds by delegation, so no component has to opt in:
//   <button> / [role=button]  → click   (override per element with data-sfx="name" or data-sfx="none")
//   segmented / tab controls  → select  (.seg-btn, .nav-tab, [role=tab], .slider > *)
//   checkbox / radio / select → toggle / select
//   <form> submit             → confirm
//   <a href> clicks           → nothing here; navigation itself plays "nav" (see initSfx caller)
export function installUiSounds() {
  if (!browser) return;
  const nameFor = (el) => {
    const tagged = el.closest("[data-sfx]");
    if (tagged) { const n = tagged.getAttribute("data-sfx"); return n === "none" ? null : n; }
    if (el.closest(".seg-btn, .nav-tab, [role=tab], .slider > *, .tab")) return "select";
    if (el.closest("button, [role=button], summary")) return "click";
    return null;
  };
  document.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el) return;
    if (el.closest("input[type=checkbox], input[type=radio], label:has(input[type=checkbox]), label:has(input[type=radio])")) return; // handled on change
    const n = nameFor(el);
    if (n) play(n);
  }, true);
  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!(el instanceof Element)) return;
    if (el.matches("input[type=checkbox], input[type=radio]")) play("toggle");
    else if (el.matches("select")) play("select");
  }, true);
  document.addEventListener("submit", () => play("confirm"), true);
}

// Play `count` copies spaced `gap` ms apart (dealing round the table).
export function playBurst(name, count, gap = 90, opts = {}) {
  for (let k = 0; k < count; k++) play(name, { ...opts, delay: (opts.delay || 0) + k * gap });
}

export const SOUND_NAMES = Object.keys(SOUNDS);
