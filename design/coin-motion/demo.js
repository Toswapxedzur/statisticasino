// Coin-motion demo. Bundled with esbuild into demo.bundle.js (see build.sh); runs the real engine
// (src/lib/poker/coin-motion.js) and the real coin art (chips.js coinSvg).
//
// Layout (owner, 2026-09-25): compact badges (the stack number right of the name); each seat's
// coins sit right beside its badge on the side facing the table centre, read like digits — the
// most valuable column against the badge, the smallest farthest, then the amount; the pot's coins
// are the same size, biggest first, with the POT pill below them. Columns keep the 60° zig-zag.
import { Money, COIN } from "../../src/lib/poker/coin-motion.js";
import { coinSvg } from "../../src/lib/poker/chips.js";

const $ = (id) => document.getElementById(id);
const STAGE_W = 900, STAGE_H = 560;
const POT = { x: 450, y: 250 };                   // the pot's coins stand on this line, centred
const SIZE = 18;                                  // the table's coin size — seats and pot alike
const PITCH = SIZE * 0.5, RAISE = SIZE * 0.6, RISE = Math.max(2, Math.round(SIZE * 0.14));
const GAP = 5;                                    // badge edge → the first column
const NAMES = ["You", "Milo", "Ivy", "Nora", "Theo", "Ada"];
// seats clockwise from the bottom, like the table's ring
const SEATS = [90, 150, 210, 270, 330, 30].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: POT.x + 330 * Math.cos(a), y: POT.y + 25 + 205 * Math.sin(a) };
});
// the side facing the centre: seats on the left half put their coins on the right, and back
const SIDE = SEATS.map((s) => (s.x > POT.x + 1 ? -1 : 1));

// ---- the hands: coin actions + what the badges say ----
const HANDS = {
  h1: {
    stacks: { 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 5: 200 },
    steps: [
      [300, "street", "Pre-flop"], [400, "bet", 1, 1, "SB 1"], [400, "bet", 2, 2, "BB 2"],
      [1300, "fold", 3], [2000, "bet", 4, 8, "Raise to 8"], [2800, "bet", 5, 8, "Call 8"], [3500, "fold", 0],
      [4200, "bet", 1, 7, "Call 8"], [4900, "bet", 2, 6, "Call 8"], [5000, "sweep"], [5000, "street", "Flop"],
      [6700, "check", 1], [7300, "check", 2], [8000, "bet", 4, 20, "Bet 20"], [8800, "bet", 5, 60, "Raise to 60"],
      [9600, "fold", 1], [10200, "fold", 2], [10900, "bet", 4, 40, "Call 60"], [11000, "sweep"], [11000, "street", "Turn"],
      [12900, "check", 4], [13600, "bet", 5, 90, "Bet 90"], [14400, "fold", 4],
      [14500, "back", 5, 90], [14500, "award", [[5, 152]]], [14500, "street", "Ada wins 152 — the uncalled 90 goes back first"],
    ],
  },
  h2: {
    stacks: { 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 5: 200 },
    steps: [
      [300, "street", "Pre-flop"], [400, "bet", 1, 1, "SB 1"], [400, "bet", 2, 2, "BB 2"],
      [1200, "bet", 3, 30, "Raise to 30"], [1900, "bet", 4, 30, "Call 30"], [2600, "fold", 5], [3200, "fold", 0],
      [3800, "bet", 1, 29, "Call 30"], [4400, "fold", 2], [4500, "sweep"], [4500, "street", "Flop"],
      [6200, "check", 1], [6700, "check", 3], [7200, "check", 4], [7300, "sweep"], [7300, "street", "Turn — all checked: nothing moves"],
      [8600, "bet", 1, 50, "Bet 50"], [9300, "bet", 3, 50, "Call 50"], [9900, "bet", 4, 50, "Call 50"],
      [10000, "sweep"], [10000, "street", "River"],
      [11300, "street", "Showdown — Nora and Theo split 242"], [11300, "award", [[3, 121], [4, 121]]],
    ],
  },
  h3: {
    stacks: { 0: 3000, 1: 3000, 2: 3000, 3: 3000, 4: 3000, 5: 3000 },
    steps: [
      [300, "street", "Pre-flop"], [400, "bet", 1, 5, "SB 5"], [400, "bet", 2, 10, "BB 10"],
      [1200, "bet", 3, 130, "Raise to 130"], [1900, "bet", 4, 130, "Call 130"], [2500, "fold", 5], [3000, "fold", 0],
      [3600, "bet", 1, 125, "Call 130"], [4300, "bet", 2, 120, "Call 130"], [4400, "sweep"], [4400, "street", "Flop — the pot carries up the ladder"],
      [6600, "check", 1], [7100, "check", 2], [7700, "bet", 3, 480, "Bet 480"], [8400, "bet", 4, 480, "Call 480"],
      [9000, "fold", 1], [9500, "fold", 2], [9600, "sweep"], [9600, "street", "Turn"],
      [12000, "street", "Theo wins 1,480"], [12000, "award", [[4, 1480]]],
    ],
  },
};

function build(hand) {
  const m = new Money(hand.stacks);
  for (const [t, kind, a, b] of hand.steps) {
    if (kind === "bet") m.bet(a, b, t);
    else if (kind === "check") m.check(a, t);
    else if (kind === "sweep") m.sweep(t);
    else if (kind === "back") m.giveBack(a, b, t);
    else if (kind === "award") m.award(a.map(([seat, amount]) => ({ seat, amount })), t);
  }
  return m;
}
function lengthOf(hand) {
  const m = build(hand), last = Math.max(...hand.steps.map((s) => s[0]));
  let t = 0;
  while (t < last || m.busy(t)) { t += 10; m.tick(t); }
  return t + 400;
}
// badge lines / folds / winners at time t (latest word per seat; a new street clears them)
function badgesAt(hand, t) {
  const say = new Map(), folded = new Set(), won = new Set();
  let street = "";
  for (const [ts, kind, a, b, c] of hand.steps) {
    if (ts > t) break;
    if (kind === "street") { street = a; for (const s of [...say.keys()]) if (!folded.has(s)) say.delete(s); }
    else if (kind === "bet") say.set(a, c);
    else if (kind === "check") say.set(a, "Check");
    else if (kind === "fold") { say.set(a, "Fold"); folded.add(a); }
    else if (kind === "award") for (const [s] of a) won.add(s);
  }
  return { say, folded, won, street };
}

// ---- coin markup ----
const coinCache = new Map();
const coin = (v) => { if (!coinCache.has(v)) coinCache.set(v, `<span class="coin">${coinSvg(v, SIZE)}</span>`); return coinCache.get(v); };
function columnHTML(denom, count) {
  const n = Math.max(1, Math.min(count, 12));
  let h = "";
  for (let k = 0; k < n; k++) h += `<span class="cc" style="bottom:${k * RISE}px">${coin(denom)}</span>`;
  return `<span class="ccol" style="height:${SIZE + (n - 1) * RISE}px">${h}</span>`;
}

// ---- the stage ----
const stage = $("stage");
const layer = document.createElement("div");
layer.className = "coins";
const badges = SEATS.map((p, i) => {
  const el = document.createElement("div");
  el.className = "badge";
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.innerHTML = `<span class="av">${NAMES[i][0]}</span><span class="txt"><span class="row1"><b>${NAMES[i]}</b><span class="stack"></span></span><span class="say"></span></span>`;
  stage.appendChild(el);
  return el;
});
const potPill = document.createElement("div");
potPill.className = "potpill";
potPill.innerHTML = `<span class="lbl">Pot</span> <b>0</b>`;
potPill.style.left = `${POT.x}px`;
potPill.style.top = `${POT.y + 10}px`;
const streetEl = document.createElement("div");
streetEl.className = "street";
streetEl.style.left = `${POT.x}px`;
streetEl.style.top = `${POT.y - 78}px`;
stage.append(streetEl, potPill, layer);

// ---- geometry: where each column stands ----
function badgeBox(seat) {
  const el = badges[seat], w = el.offsetWidth, h = el.offsetHeight, p = SEATS[seat];
  return { l: p.x - w / 2, r: p.x + w / 2, t: p.y - h / 2, b: p.y + h / 2, cx: p.x, cy: p.y };
}
/** Column positions of a pile for the given values (highest first): { denom → {x, y, back} },
 *  x = the column's centre, y = its base; `back` = the raised row of the zig-zag. */
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
/** A place's point: a column's base centre, or just inside the badge (coins slide out from under it). */
function pointOf(m, at) {
  if (at.kind === "stack") {
    const b = badgeBox(at.seat), side = SIDE[at.seat];
    return { x: side > 0 ? b.r - SIZE * 0.8 : b.l + SIZE * 0.8, y: b.cy + SIZE * 0.55 };
  }
  const ds = m.slotsOf(at.pile);
  if (!ds.includes(at.denom)) ds.push(at.denom), ds.sort((a, b) => b - a);
  return layoutOf(at.pile, ds).get(at.denom);
}
/** The amount label of a seat's pile: right after its smallest (outermost) column. */
function labelOf(seat, denoms) {
  const side = SIDE[seat], b = badgeBox(seat), base = b.cy + SIZE * 0.55;
  const lay = layoutOf(`bet:${seat}`, denoms), outer = lay.get(denoms[denoms.length - 1]);
  const x = outer ? outer.x + side * (SIZE / 2 + GAP) : (side > 0 ? b.r : b.l) + side * GAP;
  return { x, y: base - SIZE * 0.45, ax: side > 0 ? 0 : -100 };
}
function potNumber() {
  const n = potPill.querySelector("b");
  return { x: POT.x - potPill.offsetWidth / 2 + n.offsetLeft + n.offsetWidth / 2, y: POT.y + 10 + n.offsetTop + n.offsetHeight / 2 };
}

// ---- drawing ----
const colEls = new Map();     // "pile|denom" → { el, x, y, key }
const flightEls = new Map();  // flight id → { el, key }
const labelEls = new Map();   // "bet:<seat>" | "sweep:<i>" → el
let lastDraw = null;
function el(map, key, cls) {
  let e = map.get(key);
  if (!e) { e = document.createElement("div"); e.className = cls; layer.appendChild(e); map.set(key, e); }
  return e;
}

function draw(m, hand, t, snap) {
  const dt = snap || lastDraw == null ? Infinity : Math.max(0, t - lastDraw);
  lastDraw = t;
  const k = 1 - Math.exp(-dt / 70);                 // columns glide to new places (a column appears / leaves)
  // resting columns
  const live = new Set();
  for (const pile of [...m.piles.keys()]) {
    const cols = new Map(m.columnsOf(pile)), lay = layoutOf(pile, m.slotsOf(pile));
    for (const [d, pos] of lay) {
      const n = cols.get(d) || 0;
      if (!n) continue;
      const id = `${pile}|${d}`;
      live.add(id);
      let c = colEls.get(id);
      if (!c) { c = { el: document.createElement("div"), x: pos.x, y: pos.y, key: "" }; c.el.className = "col"; layer.appendChild(c.el); colEls.set(id, c); }
      c.x += (pos.x - c.x) * k; c.y += (pos.y - c.y) * k;
      const key = `${d}x${n}`;
      if (c.key !== key) { c.key = key; c.el.innerHTML = columnHTML(d, n); }
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -100%)`;
      c.el.style.zIndex = String(pos.back ? 1 : 2);
    }
  }
  for (const [id, c] of [...colEls]) if (!live.has(id)) { c.el.remove(); colEls.delete(id); }
  // flights: columns in the air, merges (radix coins → one), breaks (one → radix coins)
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
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const lift = f.kind === "column" ? Math.min(60, COIN.arc * dist) : SIZE * 0.9;   // a merge / break hops over its neighbour
    const x = a.x + (b.x - a.x) * st.s, y = a.y + (b.y - a.y) * st.s - lift * st.lift;
    r.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${1 - 0.75 * st.sink})`;
    r.el.style.opacity = String(1 - st.sink);
  }
  for (const [id, r] of [...flightEls]) if (!liveF.has(id)) { r.el.remove(); flightEls.delete(id); }
  // the amounts: after each seat pile's smallest coin; on the sweep they ride into the pot number
  const liveL = new Set();
  for (const pile of m.piles.keys()) {
    if (pile === "pot") continue;
    const amount = m.amountOf(pile) + m.flights.filter((f) => !f.landed && f.kind !== "column" && f.from.pile === pile).reduce((s, f) => s + f.amount, 0);
    if (!amount) continue;
    liveL.add(pile);
    const p = labelOf(+pile.slice(4), m.slotsOf(pile)), e = el(labelEls, pile, "amt");
    e.textContent = amount;
    e.style.transform = `translate(${p.x}px, ${p.y}px) translate(${p.ax}%, -50%)`;
    e.style.opacity = "1";
  }
  const pn = potNumber();
  m.sweeps.forEach((s, i) => {
    const u = (t - s.t0) / s.dur;
    if (u < 0 || u >= 1) return;
    const key = `sweep:${i}`;
    liveL.add(key);
    const st = m.flightAt({ t0: s.t0, dur: s.dur }, t), a = labelOf(s.seat, s.cols.map(([d]) => d));
    const x = a.x + (pn.x - a.x) * st.s, y = a.y + (pn.y - a.y) * st.s - Math.min(60, COIN.arc * Math.hypot(pn.x - a.x, pn.y - a.y)) * st.lift * 0.35;
    const fade = Math.min(1, Math.max(0, (st.u - 0.8) / 0.2));       // melts into the pot's number
    const e = el(labelEls, key, "amt");
    e.textContent = s.amount;
    e.style.transform = `translate(${x}px, ${y}px) translate(${a.ax + (-50 - a.ax) * st.s}%, -50%) scale(${1 - 0.2 * fade})`;
    e.style.opacity = String(1 - fade);
  });
  for (const [key, e] of [...labelEls]) if (!liveL.has(key)) { e.remove(); labelEls.delete(key); }
  // badges, pot, street
  const bt = badgesAt(hand, t);
  badges.forEach((e, i) => {
    e.querySelector(".stack").textContent = m.stackAt(i, t);
    e.querySelector(".say").textContent = bt.say.get(i) || "";
    e.classList.toggle("folded", bt.folded.has(i));
    e.classList.toggle("won", bt.won.has(i));
  });
  const pot = m.potAt(t);
  potPill.querySelector("b").textContent = pot;
  potPill.style.opacity = pot ? "1" : "0.45";
  streetEl.textContent = bt.street;
}

// ---- sound: the real game's files, played at the moment coins land ----
const SFX = { bet: ["bet-1", "bet-2", "bet-3"], pot: ["pot"], winChips: ["win-chips"], check: ["check"] };
const audio = {};
function sound(name) {
  if (!$("sound").checked) return;
  const files = SFX[name];
  if (!files) return;
  const f = files[Math.floor(Math.random() * files.length)];
  const src = audio[f] || (audio[f] = new Audio(`sfx/${f}.ogg`));
  const a = src.cloneNode();
  a.volume = name === "check" ? 0.6 : 0.8;
  a.play().catch(() => {});
}

// ---- playback ----
let hand = HANDS.h1, m = build(hand), dur = lengthOf(hand), t = 0, playing = false, last = 0, cueAt = 0;
window.__coinLog = [];
function clear() {
  for (const c of colEls.values()) c.el.remove();
  for (const r of flightEls.values()) r.el.remove();
  for (const e of labelEls.values()) e.remove();
  colEls.clear(); flightEls.clear(); labelEls.clear();
}
function seek(to) {
  // the engine is replayed from the start: tick(t) runs everything due up to t, in order
  m = build(hand);
  t = to;
  m.tick(t);
  cueAt = m.cues.length;
  draw(m, hand, t, true);
  ui();
}
function ui() {
  $("time").textContent = `${(t / 1000).toFixed(2)} / ${(dur / 1000).toFixed(2)} s`;
  $("scrub").value = Math.round((t / dur) * 1000);
}
function tick(now) {
  if (!playing) return;
  const dt = Math.min(50, Math.max(0, now - last));   // cap a frame's step (a late frame never skips)
  last = now;
  t = Math.min(dur, t + dt * +$("speed").value);
  m.tick(t);
  while (cueAt < m.cues.length) sound(m.cues[cueAt++].name);
  draw(m, hand, t, false);
  ui();
  window.__coinLog.push({ t: Math.round(t), flights: m.flights.length, pot: m.potAt(t) });
  if (t < dur) requestAnimationFrame(tick);
  else { playing = false; $("play").textContent = "Play again"; }
}
function play() {
  if (playing) { playing = false; $("play").textContent = "Resume"; return; }
  if (t >= dur) seek(0);
  playing = true;
  $("play").textContent = "Pause";
  last = performance.now();
  requestAnimationFrame(tick);
}
$("play").addEventListener("click", play);
$("scrub").addEventListener("input", (e) => { playing = false; $("play").textContent = "Resume"; seek((+e.target.value / 1000) * dur); });
$("hand").addEventListener("change", (e) => {
  playing = false;
  hand = HANDS[e.target.value];
  dur = lengthOf(hand);
  clear();
  $("play").textContent = "Play";
  seek(0);
});
function fit() {
  const k = Math.min(1.4, stage.parentElement.clientWidth / STAGE_W);   // may grow: the coins are the table's real (small) size
  stage.style.transform = `scale(${k})`;
  stage.parentElement.style.height = `${Math.round(STAGE_H * k)}px`;
}
window.addEventListener("resize", fit);
window.__coinPlay = play;
window.__coinSeek = seek;
fit();
seek(0);
