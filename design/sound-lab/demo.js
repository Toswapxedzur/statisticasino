// Table Sound Lab — every table animation with its sounds, fired on the exact moment of motion.
// Bundled with esbuild into demo.bundle.js (see build.sh). Runs the real engines: deck3d.js (cards),
// deck-routine.js (the shuffle), coin-motion.js (money) and the real card / coin art.
//
// Audio: Web Audio, scheduled on the audio clock a little ahead of time (a look-ahead scheduler),
// so a sound starts on the frame its card or coin lands — not whenever a timer happens to fire.
// Every clip starts on its transient (build_clips.py), so "start" = "impact".
import { drawStack, drawStackShadow, W, H, T, thickness, FULL_DECK, COUNT } from "../../src/lib/poker/deck3d.js";
import { buildRoutine } from "../../src/lib/poker/deck-routine.js";
import { renderBack, renderBoard } from "../../src/lib/poker/composer.js";
import { Money, COIN } from "../../src/lib/poker/coin-motion.js";
import { coinSvg } from "../../src/lib/poker/chips.js";
import CLIPS from "./clips.json";

const $ = (id) => document.getElementById(id);
const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
const bump = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; };
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- the events and their sounds
const EVENTS = {
  cardLand:   { scene: "deal", label: "A card lands", when: "each card, the moment it touches the seat or the board", gain: 0.8 },
  flip:       { scene: "deal", label: "Cards turn over", when: "as your two cards, the flop (once for all three), the turn and the river start to flip", gain: 0.7 },
  pileTap:    { scene: "deal", label: "A card reaches the used pile", when: "folded hands and the end-of-hand collection, card by card (each quieter than the last)", gain: 0.55 },
  pileDone:   { scene: "deal", label: "The used pile is complete", when: "once, as the last collected card lands", gain: 0.85 },
  deckSlide:  { scene: "shuffle", label: "The deck starts to move", when: "as the pile lifts off to fly in, and as the deck leaves to fly back", gain: 0.6 },
  cutDrop:    { scene: "shuffle", label: "A cut lands", when: "the top section lands on the bottom (loud), then the middle section settles on top (soft); also the split", gain: 0.8 },
  riffle:     { scene: "shuffle", label: "The shuffle", when: "one continuous riffle for the whole shuffle, or a tick as each card lands on the third pile", gain: 0.6 },
  deckLand:   { scene: "shuffle", label: "The deck lands", when: "at the table centre after the fly-in (soft), and back in its corner (full)", gain: 0.85 },
  coinsLand:  { scene: "money", label: "Coins land on a pile", when: "each column of a bet as it lands (3+ coins play the heavier variant)", gain: 0.8 },
  merge:      { scene: "money", label: "Coins merge into a bigger one", when: "a full column presses into one coin of the next value", gain: 0.7 },
  break:      { scene: "money", label: "A coin breaks into smaller ones", when: "splitting a pot or returning part of a bet needs change", gain: 0.7 },
  sweepStart: { scene: "money", label: "The piles start for the pot", when: "once, as every pile leaves together at the end of a street", gain: 0.65 },
  sweepLand:  { scene: "money", label: "The piles land in the pot", when: "once, as they all land together", gain: 0.9 },
  collect:    { scene: "money", label: "Winnings leave the pot", when: "each share, as it lifts off toward its winner", gain: 0.8 },
  sink:       { scene: "money", label: "Winnings sink into the badge", when: "as the coins disappear into the winner's badge (the number counts up)", gain: 0.6 },
  check:      { scene: "money", label: "Check", when: "a knock — no coins move", gain: 1.0 },
  allIn:      { scene: "money", label: "All-in", when: "a player pushes every coin they have (plays instead of the coin clicks)", gain: 0.95 },
};
// moments where something LANDS: the sound starts early by its clip's lead, so its main hit is on the frame
const ON_HIT = new Set(["cardLand", "pileTap", "pileDone", "cutDrop", "deckLand", "coinsLand", "merge", "break", "sweepLand", "sink"]);
const picks = {};
// default: the owner's own pick where there is one (option D), otherwise A
for (const k of Object.keys(EVENTS)) { const i = (CLIPS[k] || []).findIndex((o) => o.pick); picks[k] = i >= 0 ? i : 0; }
try { Object.assign(picks, JSON.parse(localStorage.getItem("bv-sound-lab-2") || "{}")); } catch {}
const savePicks = () => { try { localStorage.setItem("bv-sound-lab-2", JSON.stringify(picks)); } catch {} };

// ---------------------------------------------------------------- audio
let ctx = null, master = null;
const buffers = new Map();
const rr = new Map();                 // round-robin position per option
const lastAt = new Map();             // per event: last scheduled time (rate limit)
async function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = +$("vol").value;
  master.connect(ctx.destination);
  const files = new Set();
  for (const opts of Object.values(CLIPS)) for (const o of opts) for (const c of [...o.clips, ...(o.many || []), ...Object.values(o.tiers || {}).flat()]) files.add(c.file);
  $("status").textContent = "Loading sounds…";
  await Promise.all([...files].map(async (f) => {
    try { buffers.set(f, await ctx.decodeAudioData(await (await fetch(f)).arrayBuffer())); } catch { /* a missing clip plays nothing */ }
  }));
  $("status").textContent = "";
  return ctx;
}
function clipFor(event, count) {
  const pick = picks[event];
  const opt = CLIPS[event]?.[pick];
  if (!opt) return null;
  // tiers (the owner's coins): 1 coin · 2–4 · 5+; else the heavier variant for 3+ coins
  const tier = opt.tiers ? (count >= 5 ? "pile" : count >= 2 ? "few" : "one") : null;
  const list = tier ? opt.tiers[tier] : count >= 3 && opt.many ? opt.many : opt.clips;
  const key = `${event}:${pick}:${tier || (list === opt.many ? "m" : "s")}`;
  const i = rr.get(key) || 0;
  rr.set(key, i + 1);
  const c = list[i % list.length];
  return c && buffers.get(c.file) ? { buf: buffers.get(c.file), lead: (c.lead || 0) / 1000 } : null;
}
/** Play `event` at audio time `when`. x = 0..1 across the stage (for the left/right pan). */
function sound(event, when, { x = 0.5, gain = 1, dur = null, count = 1 } = {}) {
  if (!ctx || picks[event] < 0) return;
  const ticks = !!CLIPS.riffle[picks.riffle]?.ticks;                       // this riffle option = a tick per card
  if (event === "riffle" && ticks && dur) return;                          // ticks mode: skip the long take
  if (event === "riffleTick") { if (!ticks) return; event = "riffle"; }
  const last = lastAt.get(event) ?? -1;
  if (when - last < 0.022) return;                                        // two of the same within 22 ms: one sound
  lastAt.set(event, when);
  const clip = clipFor(event, count);
  if (!clip) return;
  if (ON_HIT.has(event)) when = Math.max(ctx.currentTime, when - clip.lead);   // land the main hit on the frame
  const src = ctx.createBufferSource();
  src.buffer = clip.buf;
  const g = ctx.createGain();
  g.gain.value = EVENTS[event].gain * gain;
  let node = g;
  if ($("pan").checked && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, (x * 2 - 1) * 0.55));
    g.connect(p); node = p;
  }
  node.connect(master);
  src.connect(g);
  if (dur) {                                                               // a long take trimmed to its moment
    g.gain.setValueAtTime(g.gain.value, when + Math.max(0, dur - 0.18));
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    src.start(when); src.stop(when + dur + 0.02);
  } else src.start(when);
}

// ---------------------------------------------------------------- card art
const cache = new Map();
async function inline(markup) {
  let svg = markup.match(/<svg[\s\S]*<\/svg>/)[0];
  for (const [, file] of svg.matchAll(/href="\/deck-parts\/([^"]+)"/g)) {
    if (!cache.has(file)) cache.set(file, "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(await (await fetch("deck-parts/" + file)).text()))));
    svg = svg.replaceAll(`href="/deck-parts/${file}"`, `href="${cache.get(file)}"`);
  }
  return svg;
}
async function toImage(markup, px = 360) {
  const svg = (await inline(markup)).replace(/width="\d+" height="\d+"/, `width="${px}" height="${Math.round((px * H) / W)}"`);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  return img;
}

// ---------------------------------------------------------------- scene 1: dealing a hand
const STAGE_W = 700, STAGE_H = 420, BAR = 28;
const DECK_AT = { fx: -0.2 * W, fy: BAR + 6 + H / 2 + T }, USED_AT = { fx: STAGE_W + 0.2 * W, fy: DECK_AT.fy };
const SEATS = { L: [{ fx: 70, fy: 300 }, { fx: 134, fy: 300 }], B: [{ fx: 318, fy: 356 }, { fx: 382, fy: 356 }], R: [{ fx: 566, fy: 300 }, { fx: 630, fy: 300 }] };
const BOARD = [0, 1, 2, 3, 4].map((i) => ({ fx: 350 + (i - 2) * 66, fy: 196 }));
const FACES = ["As", "Kd", "7c", "7h", "Qs", "Jd", "Th", "9c", "2s", "Ah", "5d"];
function buildDeal() {
  const cards = [], events = [];
  let n = 0;
  const card = (face) => { const c = { id: FULL_DECK[n++], face, segs: [] }; cards.push(c); return c; };
  const fly = (c, t0, from, to, o = {}) => c.segs.push({ t0, dur: o.dur ?? 380, from, to, th0: o.th0 ?? 0, th1: o.th1 ?? o.th0 ?? 0, arc: o.arc ?? 14 });
  const flipAt = (c, t0, at) => c.segs.push({ t0, dur: 420, from: at, to: at, th0: 0, th1: Math.PI, arc: 22, flip: true });
  const X = (p) => p.fx / STAGE_W;
  // two rounds, clockwise from the left of the button (L, B = you, R), a card every 110 ms
  const hands = { L: [], B: [], R: [] };
  let k = 0;
  for (let r = 0; r < 2; r++) for (const s of ["L", "B", "R"]) {
    const c = card(s === "B" ? FACES[r] : null), t0 = 300 + k++ * 110, to = SEATS[s][r];
    fly(c, t0, "deck", to); hands[s].push(c);
    events.push({ t: t0 + 380, name: "cardLand", x: X(to) });
  }
  const myLand = 300 + 4 * 110 + 380;
  hands.B.forEach((c, r) => flipAt(c, myLand + 120, SEATS.B[r]));
  events.push({ t: myLand + 120, name: "flip", x: X(SEATS.B[0]) });
  // flop (three, then one flip for all), turn, river
  const board = [];
  const street = (t, slots) => {
    let last = 0;
    slots.forEach((i, j) => { const c = card(FACES[2 + i]), t0 = t + j * 90; fly(c, t0, "deck", BOARD[i]); board.push(c); last = t0 + 380; events.push({ t: last, name: "cardLand", x: X(BOARD[i]) }); });
    board.slice(-slots.length).forEach((c, j) => flipAt(c, last + 120, BOARD[slots[j]]));
    events.push({ t: last + 120, name: "flip", x: X(BOARD[slots[1] ?? slots[0]]) });
  };
  street(2000, [0, 1, 2]); street(3700, [3]); street(5100, [4]);
  // the left seat folds: its cards to the used pile, face-down
  hands.L.forEach((c, r) => { const t0 = 6500 + r * 40; fly(c, t0, SEATS.L[r], "used", { dur: 420, arc: 18 }); events.push({ t: t0 + 420, name: "pileTap", x: 1, gain: 1 }); });
  // the hand is over: everything else to the used pile, 30 ms apart; each tap a little quieter
  const rest = [...hands.B.map((c, r) => [c, SEATS.B[r], Math.PI]), ...hands.R.map((c, r) => [c, SEATS.R[r], 0]), ...board.map((c, i) => [c, BOARD[i], Math.PI])];
  rest.forEach(([c, at, th], i) => { const t0 = 8000 + i * 30; fly(c, t0, at, "used", { dur: 420, arc: 18, th0: th, th1: th }); events.push({ t: t0 + 420, name: "pileTap", x: 1, gain: Math.max(0.35, 1 - i * 0.07) }); });
  const done = 8000 + (rest.length - 1) * 30 + 420;
  events.push({ t: done + 30, name: "pileDone", x: 1 });
  const launched = (t) => cards.filter((c) => c.segs[0].t0 <= t).length;
  return { cards, events: events.sort((a, b) => a.t - b.t), duration: done + 900, launched };
}

function dealDraw(scene, cctx, t, art) {
  const { cards, launched } = scene;
  const deckIds = FULL_DECK.slice(launched(t));
  const used = [], lying = [], air = [];
  for (const c of cards) {
    const segs = c.segs;
    if (segs[0].t0 > t) continue;
    let pose = null;
    for (const s of segs) {
      if (t < s.t0) break;
      const u = (t - s.t0) / s.dur;
      const A = s.from === "deck" ? { ...DECK_AT, z: thickness(COUNT - launched(s.t0) + 1) } : s.from === "used" ? { ...USED_AT, z: 0 } : { ...s.from, z: 0 };
      const B = s.to === "used" ? { ...USED_AT, z: thickness(used.length) } : s.to === "deck" ? { ...DECK_AT, z: 0 } : { ...s.to, z: 0 };
      if (u >= 1) pose = { at: B, th: s.th1, landedUsed: s.to === "used" };
      else { const m = mj(u); pose = { fx: lerp(A.fx, B.fx, m), fy: lerp(A.fy, B.fy, m), z: lerp(A.z, B.z, m) + s.arc * bump(u), th: s.flip ? lerp(s.th0, s.th1, m) : s.th0, air: true }; }
    }
    if (!pose) continue;
    if (pose.landedUsed) { used.push(c); continue; }
    if (pose.air) air.push({ ids: [c.id], theta: pose.th, fx: pose.fx, fy: pose.fy, baseZ: pose.z, faceId: c });
    else lying.push({ ids: [c.id], theta: pose.th, fx: pose.at.fx, fy: pose.at.fy, faceId: c });
  }
  const faceOf = (id) => { const c = cards.find((x) => x.id === id); return c?.face ? art.faces.get(c.face) : null; };
  const stacks = [];
  if (deckIds.length) stacks.push({ ids: deckIds, fx: DECK_AT.fx, fy: DECK_AT.fy });
  if (used.length) stacks.push({ ids: used.map((c) => c.id), theta: Math.PI, fx: USED_AT.fx, fy: USED_AT.fy });
  stacks.push(...lying.sort((a, b) => a.fy - b.fy), ...air.sort((a, b) => a.baseZ - b.baseZ));
  for (const s of stacks) drawStackShadow(cctx, s);
  for (const s of stacks) drawStack(cctx, s, { back: art.back, faceOf });
}

// ---------------------------------------------------------------- scene 2: the shuffle
function buildShuffle(seed) {
  const R = buildRoutine({ start: USED_AT, end: DECK_AT, centre: { fx: 350, fy: 240 }, seed });
  const P = (n) => R.phases.find((p) => p.name === n);
  const events = [], cx = 0.5;
  const fly = P("fly-in"), back = P("fly-back"), split = P("split"), shuf = P("shuffle");
  events.push({ t: fly.t0, name: "deckSlide", x: 1 });
  events.push({ t: fly.t1, name: "deckLand", x: cx, gain: 0.55 });
  R.phases.filter((p) => p.name.startsWith("cut ")).forEach((p, i) => {
    const c = R.cuts[i];
    events.push({ t: p.t0 + c.tTouch * (p.t1 - p.t0), name: "cutDrop", x: cx });
    events.push({ t: p.t1, name: "cutDrop", x: cx + 0.04, gain: 0.45 });
  });
  events.push({ t: split.t1, name: "cutDrop", x: cx, gain: 0.6 });
  events.push({ t: shuf.t0, name: "riffle", x: cx, dur: (shuf.t1 - shuf.t0) / 1000 });
  for (let i = 0; i < COUNT; i++) events.push({ t: shuf.t0 + i * 45 + 320, name: "riffleTick", x: cx, gain: 0.45 });
  events.push({ t: back.t0, name: "deckSlide", x: cx, gain: 0.8 });
  events.push({ t: back.t1, name: "deckLand", x: 0 });
  return { R, events: events.sort((a, b) => a.t - b.t), duration: R.duration + 500 };
}

// ---------------------------------------------------------------- scene 3: money
const M_W = 900, M_H = 560, POT = { x: 450, y: 250 }, SIZE = 18;
const PITCH = SIZE * 0.5, RAISE = SIZE * 0.6, RISE = Math.max(2, Math.round(SIZE * 0.14)), GAP = 5;
const NAMES = ["You", "Milo", "Ivy", "Nora", "Theo", "Ada"];
const MSEATS = [90, 150, 210, 270, 330, 30].map((deg) => { const a = (deg * Math.PI) / 180; return { x: POT.x + 330 * Math.cos(a), y: POT.y + 25 + 205 * Math.sin(a) }; });
const SIDE = MSEATS.map((s) => (s.x > POT.x + 1 ? -1 : 1));
const HAND = [
  [300, "street", "Pre-flop"], [400, "bet", 1, 1, "SB 1"], [400, "bet", 2, 2, "BB 2"],
  [1300, "fold", 3], [2000, "bet", 4, 8, "Raise to 8"], [2800, "bet", 5, 8, "Call 8"], [3500, "fold", 0],
  [4200, "bet", 1, 7, "Call 8"], [4900, "bet", 2, 6, "Call 8"], [5000, "sweep"], [5000, "street", "Flop"],
  [6600, "check", 1], [7200, "check", 2], [7900, "bet", 4, 20, "Bet 20"], [8700, "bet", 5, 60, "Raise to 60"],
  [9400, "fold", 1], [9900, "fold", 2], [10500, "bet", 4, 40, "Call 60"], [10600, "sweep"], [10600, "street", "Turn"],
  [11800, "bet", 5, 90, "Bet 90"], [12700, "bet", 4, 132, "All-in 132"], [13600, "bet", 5, 42, "Call — all-in"],
  [13700, "sweep"], [13700, "street", "River — both all-in"],
  [14700, "street", "Showdown — Theo and Ada split 416"], [14700, "award", [[4, 208], [5, 208]]],
];
function buildMoney() {
  const m = new Money({ 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 5: 200 });
  for (const [t, kind, a, b] of HAND) {
    if (kind === "bet") m.bet(a, b, t);
    else if (kind === "check") m.check(a, t);
    else if (kind === "sweep") m.sweep(t);
    else if (kind === "award") m.award(a.map(([seat, amount]) => ({ seat, amount })), t);
  }
  return m;
}
function moneyScene() {
  // run once to learn the cues and the length
  const m = buildMoney();
  let t = 0;
  while (t < 14700 || m.busy(t)) { t += 10; m.tick(t); }
  const MAP = { coins: "coinsLand", allIn: "allIn", merge: "merge", break: "break", sweep: "sweepStart", pot: "sweepLand", collect: "collect", sink: "sink", check: "check" };
  const pos = (at) => at?.kind === "stack" ? MSEATS[at.seat] : at?.kind === "slot" && at.pile.startsWith("bet:") ? MSEATS[+at.pile.slice(4)] : POT;
  const events = m.cues.filter((c) => MAP[c.name]).map((c) => ({ t: c.t, name: MAP[c.name], x: pos(c.at).x / M_W, count: c.count || 1 }));
  return { events: events.sort((a, b) => a.t - b.t), duration: t + 600 };
}

// the money stage (DOM, like the table)
const mstage = $("mstage");
const layer = document.createElement("div");
layer.className = "coins";
const badges = MSEATS.map((p, i) => {
  const el = document.createElement("div");
  el.className = "badge";
  el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  el.innerHTML = `<span class="av">${NAMES[i][0]}</span><span class="txt"><span class="row1"><b>${NAMES[i]}</b><span class="stack"></span></span><span class="say"></span></span>`;
  mstage.appendChild(el);
  return el;
});
const potPill = document.createElement("div");
potPill.className = "potpill";
potPill.innerHTML = `<span class="lbl">Pot</span> <b>0</b>`;
potPill.style.left = `${POT.x}px`; potPill.style.top = `${POT.y + 10}px`;
const streetEl = document.createElement("div");
streetEl.className = "street";
streetEl.style.left = `${POT.x}px`; streetEl.style.top = `${POT.y - 78}px`;
mstage.append(streetEl, potPill, layer);
const coinCache = new Map();
const coin = (v) => { if (!coinCache.has(v)) coinCache.set(v, `<span class="coin">${coinSvg(v, SIZE)}</span>`); return coinCache.get(v); };
function columnHTML(denom, count) {
  const n = Math.max(1, Math.min(count, 12));
  let h = "";
  for (let k = 0; k < n; k++) h += `<span class="cc" style="bottom:${k * RISE}px">${coin(denom)}</span>`;
  return `<span class="ccol" style="height:${SIZE + (n - 1) * RISE}px">${h}</span>`;
}
function badgeBox(seat) { const el = badges[seat], w = el.offsetWidth, h = el.offsetHeight, p = MSEATS[seat]; return { l: p.x - w / 2, r: p.x + w / 2, cy: p.y }; }
function layoutOf(pile, denoms) {
  const out = new Map();
  if (pile === "pot") {
    const width = SIZE + Math.max(0, denoms.length - 1) * PITCH;
    denoms.forEach((d, i) => out.set(d, { x: POT.x - width / 2 + SIZE / 2 + i * PITCH, y: POT.y - (i % 2 ? RAISE : 0), back: i % 2 === 1 }));
    return out;
  }
  const seat = +pile.slice(4), b = badgeBox(seat), side = SIDE[seat];
  const x0 = side > 0 ? b.r + GAP + SIZE / 2 : b.l - GAP - SIZE / 2, base = b.cy + SIZE * 0.55;
  denoms.forEach((d, i) => out.set(d, { x: x0 + side * i * PITCH, y: base - (i % 2 ? RAISE : 0), back: i % 2 === 1 }));
  return out;
}
function pointOf(m, at) {
  if (at.kind === "stack") { const b = badgeBox(at.seat), side = SIDE[at.seat]; return { x: side > 0 ? b.r - SIZE * 0.5 : b.l + SIZE * 0.5, y: b.cy + SIZE * 0.55 }; }
  const ds = m.slotsOf(at.pile);
  if (!ds.includes(at.denom)) { ds.push(at.denom); ds.sort((a, b) => b - a); }
  return layoutOf(at.pile, ds).get(at.denom);
}
function labelOf(seat, denoms) {
  const side = SIDE[seat], b = badgeBox(seat), lay = layoutOf(`bet:${seat}`, denoms), outer = lay.get(denoms[denoms.length - 1]);
  return { x: outer ? outer.x + side * (SIZE / 2 + GAP) : (side > 0 ? b.r : b.l) + side * GAP, y: b.cy + SIZE * 0.1, ax: side > 0 ? 0 : -100 };
}
function potNumber() { const n = potPill.querySelector("b"); return { x: POT.x - potPill.offsetWidth / 2 + n.offsetLeft + n.offsetWidth / 2, y: POT.y + 10 + n.offsetTop + n.offsetHeight / 2 }; }
const colEls = new Map(), flightEls = new Map(), labelEls = new Map();
function el(map, key, cls) { let e = map.get(key); if (!e) { e = document.createElement("div"); e.className = cls; layer.appendChild(e); map.set(key, e); } return e; }
function moneyDraw(m, t) {
  const live = new Set();
  for (const pile of m.piles.keys()) {
    const cols = new Map(m.columnsOf(pile)), lay = layoutOf(pile, m.slotsOf(pile));
    for (const [d, p] of lay) {
      const n = cols.get(d) || 0;
      if (!n) continue;
      const id = `${pile}|${d}`; live.add(id);
      let c = colEls.get(id);
      if (!c) { c = { el: document.createElement("div"), key: "" }; c.el.className = "col"; layer.appendChild(c.el); colEls.set(id, c); }
      const key = `${d}x${n}`;
      if (c.key !== key) { c.key = key; c.el.innerHTML = columnHTML(d, n); }
      c.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      c.el.style.zIndex = p.back ? "1" : "2";
    }
  }
  for (const [id, c] of [...colEls]) if (!live.has(id)) { c.el.remove(); colEls.delete(id); }
  const liveF = new Set();
  for (const f of m.flights) {
    liveF.add(f.id);
    const st = m.flightAt(f, t), a = pointOf(m, f.from), b = pointOf(m, f.to);
    let denom = f.denom, count = f.count;
    if (f.kind === "merge") { count = Math.max(1, Math.round(f.count - (f.count - 1) * st.s)); if (st.s > 0.5) denom = f.toDenom; }
    if (f.kind === "break") { count = Math.max(1, Math.round(1 + (f.toCount - 1) * st.s)); if (st.s > 0.5) denom = f.toDenom; }
    let r = flightEls.get(f.id);
    if (!r) { r = { el: document.createElement("div"), key: "" }; r.el.className = "flight"; layer.appendChild(r.el); flightEls.set(f.id, r); }
    const key = `${denom}x${count}`;
    if (r.key !== key) { r.key = key; r.el.innerHTML = columnHTML(denom, count); }
    const lift = f.kind === "column" ? Math.min(60, COIN.arc * Math.hypot(b.x - a.x, b.y - a.y)) : SIZE * 0.9;
    const grow = f.from.kind === "stack" ? Math.min(1, st.u / 0.18) : 1;
    r.el.style.transform = `translate(${a.x + (b.x - a.x) * st.s}px, ${a.y + (b.y - a.y) * st.s - lift * st.lift}px) translate(-50%, -100%) scale(${grow * (1 - 0.75 * st.sink)})`;
    r.el.style.opacity = String(Math.min(grow, 1 - st.sink));
  }
  for (const [id, r] of [...flightEls]) if (!liveF.has(id)) { r.el.remove(); flightEls.delete(id); }
  const liveL = new Set();
  for (const pile of m.piles.keys()) {
    if (pile === "pot") continue;
    const amount = m.pileAt(pile);
    if (!amount) continue;
    liveL.add(pile);
    const p = labelOf(+pile.slice(4), m.slotsOf(pile)), e = el(labelEls, pile, "amt");
    e.textContent = amount;
    e.style.transform = `translate(${p.x}px, ${p.y}px) translate(${p.ax}%, -50%)`; e.style.opacity = "1";
  }
  const pn = potNumber();
  m.sweeps.forEach((s, i) => {
    if (t < s.t0 || t >= s.t0 + s.dur) return;
    const key = `sweep:${i}`; liveL.add(key);
    const st = m.flightAt({ t0: s.t0, dur: s.dur }, t), a = labelOf(s.seat, s.cols.map(([d]) => d));
    const fade = Math.min(1, Math.max(0, (st.u - 0.8) / 0.2)), e = el(labelEls, key, "amt");
    e.textContent = s.amount;
    e.style.transform = `translate(${a.x + (pn.x - a.x) * st.s}px, ${a.y + (pn.y - a.y) * st.s}px) translate(${a.ax + (-50 - a.ax) * st.s}%, -50%) scale(${1 - 0.2 * fade})`;
    e.style.opacity = String(1 - fade);
  });
  for (const [key, e] of [...labelEls]) if (!liveL.has(key)) { e.remove(); labelEls.delete(key); }
  const say = new Map(), folded = new Set(), won = new Set();
  let street = "";
  for (const [ts, kind, a, b, c] of HAND) {
    if (ts > t) break;
    if (kind === "street") { street = a; for (const s of [...say.keys()]) if (!folded.has(s)) say.delete(s); }
    else if (kind === "bet") say.set(a, c);
    else if (kind === "check") say.set(a, "Check");
    else if (kind === "fold") { say.set(a, "Fold"); folded.add(a); }
    else if (kind === "award") for (const [s] of a) won.add(s);
  }
  badges.forEach((e, i) => {
    e.querySelector(".stack").textContent = m.stackAt(i, t);
    e.querySelector(".say").textContent = say.get(i) || "";
    e.classList.toggle("folded", folded.has(i));
    e.classList.toggle("won", won.has(i));
  });
  const pot = m.potAt(t);
  potPill.querySelector("b").textContent = pot;
  potPill.style.opacity = pot ? "1" : "0.45";
  streetEl.textContent = street;
}

// ---------------------------------------------------------------- playback (one scene at a time)
const scenes = {};
let active = null;
function stopAll() {
  if (active) { active.playing = false; $(`play-${active.key}`).textContent = "Play"; active = null; }
}
async function play(key) {
  if (active?.key === key) { stopAll(); return; }
  stopAll();
  await audio();
  if (ctx.state === "suspended") await ctx.resume();
  const sc = scenes[key];
  sc.reset();
  const speed = +$("speed").value;
  const lead = 0.08;
  const run = { key, playing: true, speed, audio0: ctx.currentTime + lead, perf0: performance.now() + lead * 1000, next: 0 };
  active = run;
  $(`play-${key}`).textContent = "Stop";
  const events = sc.events();
  const loop = () => {
    if (!run.playing) return;
    const t = Math.max(0, (performance.now() - run.perf0) * run.speed);
    // schedule everything due in the next 150 ms of audio (exact start times on the audio clock)
    const horizon = t + 150 * run.speed;
    while (run.next < events.length && events[run.next].t <= horizon) {
      const e = events[run.next++];
      sound(e.name, run.audio0 + e.t / 1000 / run.speed, { x: e.x, gain: e.gain ?? 1, dur: e.dur ? e.dur / run.speed : null, count: e.count });
    }
    sc.draw(t);
    $(`time-${key}`).textContent = `${(t / 1000).toFixed(1)} / ${(sc.duration / 1000).toFixed(1)} s`;
    if (t >= sc.duration) { run.playing = false; $(`play-${key}`).textContent = "Play again"; if (active === run) active = null; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- the picker rows
let tryCount = -1;   // ▶ on the coin tiers walks 1 coin → a few → a pile
function rows() {
  for (const [event, meta] of Object.entries(EVENTS)) {
    const host = $(`events-${meta.scene}`);
    const row = document.createElement("div");
    row.className = "ev";
    const opts = CLIPS[event] || [];
    const id = `pick-${event}`;
    row.innerHTML = `<div class="evh"><b>${meta.label}</b><span>${meta.when}</span></div><div class="opts" role="radiogroup" aria-label="${meta.label}"></div>`;
    const box = row.querySelector(".opts");
    const addOpt = (i, label, clip) => {
      const o = document.createElement("div");
      o.className = "opt";
      const ring = clip && clip.pitch > 0.45 ? `<em title="measured pitch share ${clip.pitch}">rings a little</em>` : "";
      o.innerHTML = `<label><input type="radio" name="${id}" value="${i}" ${picks[event] === i ? "checked" : ""}> <span class="letter">${i < 0 ? "–" : "ABCD"[i]}</span> ${label} ${ring}</label>${i >= 0 ? `<button type="button" class="try" aria-label="Hear ${label}">▶</button>` : ""}`;
      o.querySelector("input").addEventListener("change", () => { picks[event] = i; savePicks(); });
      o.querySelector(".try")?.addEventListener("click", async () => {
        await audio(); if (ctx.state === "suspended") await ctx.resume();
        const was = picks[event]; picks[event] = i;
        lastAt.delete(event);
        sound(event, ctx.currentTime + 0.3, { dur: event === "riffle" && !CLIPS.riffle[i]?.ticks ? 2.6 : null, count: event === "coinsLand" ? [1, 3, 6][(tryCount = (tryCount + 1) % 3)] : 1 });
        picks[event] = was;
      });
      box.appendChild(o);
    };
    opts.forEach((o, i) => addOpt(i, o.label, o.clips[0]));
    addOpt(-1, "Off", null);
    host.appendChild(row);
  }
}
function copyPicks() {
  const text = Object.entries(EVENTS).map(([k, m]) => `${m.label}: ${picks[k] < 0 ? "off" : `${"ABCD"[picks[k]]} (${CLIPS[k][picks[k]].label})`}`).join("\n");
  const out = $("picks-text");
  out.value = text; out.hidden = false;
  navigator.clipboard?.writeText(text).then(() => { $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy my picks"), 1500); }).catch(() => { out.select(); });
}

// ---------------------------------------------------------------- boot
(async () => {
  rows();
  const back = await toImage(renderBack(60, { edge: false }));
  const faces = new Map();
  for (const f of FACES) faces.set(f, await toImage(renderBoard(f, 60, { edge: false })));
  const art = { back, faces };
  const canvases = {};
  for (const key of ["deal", "shuffle"]) {
    const cv = $(`cv-${key}`), c2 = cv.getContext("2d");
    canvases[key] = { cv, c2, scale: 1, dpr: 1 };
  }
  function fit() {
    for (const c of Object.values(canvases)) {
      c.dpr = window.devicePixelRatio || 1;
      c.scale = Math.min(1.25, c.cv.parentElement.clientWidth / STAGE_W);
      c.cv.style.width = `${Math.round(STAGE_W * c.scale)}px`; c.cv.style.height = `${Math.round(STAGE_H * c.scale)}px`;
      c.cv.width = Math.round(STAGE_W * c.scale * c.dpr); c.cv.height = Math.round(STAGE_H * c.scale * c.dpr);
    }
    const k = Math.min(1.25, mstage.parentElement.clientWidth / M_W);
    mstage.style.transform = `scale(${k})`;
    mstage.parentElement.style.height = `${Math.round(M_H * k)}px`;
  }
  const begin = (c) => {
    c.c2.setTransform(1, 0, 0, 1, 0, 0); c.c2.clearRect(0, 0, c.cv.width, c.cv.height);
    c.c2.setTransform(c.dpr * c.scale, 0, 0, c.dpr * c.scale, 0, 0);
    c.c2.fillStyle = "rgba(147,163,198,0.10)"; c.c2.fillRect(0, 0, STAGE_W, BAR);
  };
  // deal
  let deal = buildDeal();
  scenes.deal = { duration: deal.duration, events: () => deal.events, reset: () => {}, draw: (t) => { begin(canvases.deal); dealDraw(deal, canvases.deal.c2, t, art); } };
  // shuffle
  let shuf = buildShuffle(Math.floor(Math.random() * 1e9));
  const shufFace = faces.get("As");
  scenes.shuffle = {
    get duration() { return shuf.duration; }, events: () => shuf.events,
    reset: () => { shuf = buildShuffle(Math.floor(Math.random() * 1e9)); },
    draw: (t) => { begin(canvases.shuffle); const f = shuf.R.frameAt(t); for (const s of f.stacks) drawStackShadow(canvases.shuffle.c2, s); for (const s of f.stacks) drawStack(canvases.shuffle.c2, s, { back, face: shufFace }); },
  };
  // money
  let money = moneyScene(), mm = buildMoney();
  scenes.money = {
    duration: money.duration, events: () => money.events,
    reset: () => { mm = buildMoney(); for (const m of [colEls, flightEls]) { for (const c of m.values()) c.el.remove(); m.clear(); } for (const e of labelEls.values()) e.remove(); labelEls.clear(); },
    draw: (t) => { mm.tick(t); moneyDraw(mm, t); },
  };
  for (const key of Object.keys(scenes)) $(`play-${key}`).addEventListener("click", () => play(key));
  $("vol").addEventListener("input", (e) => { if (master) master.gain.value = +e.target.value; });
  $("copy").addEventListener("click", copyPicks);
  window.addEventListener("resize", () => { fit(); });
  fit();
  scenes.deal.draw(0); scenes.shuffle.draw(0); moneyDraw(mm, 0);
  window.__lab = { scenes, picks, play, events: (k) => scenes[k].events() };
})();
