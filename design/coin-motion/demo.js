// Coin-motion demo. Bundled with esbuild into demo.bundle.js (see build.sh); runs the real engine
// (src/lib/poker/coin-motion.js) and the real coin art (chips.js coinSvg, CoinStack's pile layout).
import { Money, COIN } from "../../src/lib/poker/coin-motion.js";
import { coinSvg } from "../../src/lib/poker/chips.js";

const $ = (id) => document.getElementById(id);
const STAGE_W = 900, STAGE_H = 560;
const POT = { x: 450, y: 262 };
const BET_SIZE = 18, POT_SIZE = 20;               // the table's real coin sizes (SeatBadge / CommunityBoard)
const NAMES = ["You", "Milo", "Ivy", "Nora", "Theo", "Ada"];
// seats clockwise from the bottom, like the table's ring
const SEATS = [90, 150, 210, 270, 330, 30].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: POT.x + 360 * Math.cos(a), y: POT.y + 20 + 215 * Math.sin(a) };
});
const BET = SEATS.map((s) => ({ x: s.x + 0.42 * (POT.x - s.x), y: s.y + 0.42 * (POT.y - s.y) + 14 }));

// ---- the two hands: coin actions + what the badges say ----
const HANDS = {
  h1: {
    title: "Raise, sweep, an uncalled bet, the win",
    stacks: { 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 5: 200 },
    steps: [
      [300, "street", "Pre-flop"], [400, "bet", 1, 1, "SB 1"], [400, "bet", 2, 2, "BB 2"],
      [1300, "fold", 3], [2000, "bet", 4, 8, "Raise to 8"], [2800, "bet", 5, 8, "Call 8"], [3500, "fold", 0],
      [4200, "bet", 1, 7, "Call 8"], [4900, "bet", 2, 6, "Call 8"], [5000, "sweep"], [5000, "street", "Flop"],
      [6400, "check", 1], [7000, "check", 2], [7700, "bet", 4, 20, "Bet 20"], [8500, "bet", 5, 60, "Raise to 60"],
      [9300, "fold", 1], [9900, "fold", 2], [10600, "bet", 4, 40, "Call 60"], [10700, "sweep"], [10700, "street", "Turn"],
      [12000, "check", 4], [12700, "bet", 5, 90, "Bet 90"], [13500, "fold", 4],
      [13600, "back", 5, 90], [13600, "award", [[5, 152]]], [13600, "street", "Ada wins 152 — the uncalled 90 goes back first"],
    ],
  },
  h2: {
    title: "A checked-through street, a showdown, a split pot",
    stacks: { 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 5: 200 },
    steps: [
      [300, "street", "Pre-flop"], [400, "bet", 1, 1, "SB 1"], [400, "bet", 2, 2, "BB 2"],
      [1200, "bet", 3, 30, "Raise to 30"], [1900, "bet", 4, 30, "Call 30"], [2600, "fold", 5], [3200, "fold", 0],
      [3800, "bet", 1, 29, "Call 30"], [4400, "fold", 2], [4500, "sweep"], [4500, "street", "Flop"],
      [5800, "check", 1], [6300, "check", 3], [6800, "check", 4], [6900, "sweep"], [6900, "street", "Turn — all checked: nothing moves"],
      [8200, "bet", 1, 50, "Bet 50"], [8900, "bet", 3, 50, "Call 50"], [9500, "bet", 4, 50, "Call 50"],
      [9600, "sweep"], [9600, "street", "River"],
      [10800, "street", "Showdown — Nora and Theo split 242"], [10800, "award", [[3, 121], [4, 121]]],
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
// the hand's length: run it to rest once
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

// ---- coin markup (CoinStack's pile: one column per denomination, 60° zig-zag, tight rise) ----
const DENOMS = [5000000, 1000000, 250000, 50000, 10000, 2500, 500, 100, 25, 5, 1];
const coinCache = new Map();
const coin = (v, size) => { const k = v + "@" + size; if (!coinCache.has(k)) coinCache.set(k, `<span class="coin">${coinSvg(v, size)}</span>`); return coinCache.get(k); };
function column(denom, count, size, hi = false) {
  const rise = Math.max(2, Math.round(size * 0.14)), n = Math.min(count, 5);
  let h = "";
  for (let k = 0; k < n; k++) h += `<span class="cc" style="bottom:${k * rise}px">${coin(denom, size)}</span>`;
  return `<span class="ccol${hi ? " hi" : ""}" style="height:${size + (n - 1) * rise}px">${h}</span>`;
}
function pileHTML(amount, size) {
  let n = Math.max(0, Math.floor(amount));
  const cols = [];
  for (const d of DENOMS) if (n >= d) { const c = Math.floor(n / d); n -= c * d; cols.push([d, c]); }
  return `<span class="cstack" style="--sz:${size}px">${cols.slice(0, 5).map(([d, c], i) => column(d, c, size, i % 2 === 1)).join("")}</span>`;
}

// ---- the stage ----
const stage = $("stage");
const layer = document.createElement("div");
layer.className = "coins";
function makeBadges() {
  const out = [];
  SEATS.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "badge";
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.innerHTML = `<span class="av">${NAMES[i][0]}</span><span class="txt"><b>${NAMES[i]}</b><span class="stack"></span><span class="say"></span></span>`;
    stage.appendChild(el);
    out.push(el);
  });
  return out;
}
const badges = makeBadges();
const potPill = document.createElement("div");
potPill.className = "potpill";
potPill.innerHTML = `<span class="lbl">Pot</span> <b>0</b>`;
potPill.style.left = `${POT.x}px`;
potPill.style.top = `${POT.y + 18}px`;
const streetEl = document.createElement("div");
streetEl.className = "street";
streetEl.style.left = `${POT.x}px`;
streetEl.style.top = `${POT.y - 92}px`;
stage.append(streetEl, potPill, layer);

// coins leave / reach a badge at its edge facing the pot, not over the player's name
const EDGE = SEATS.map((s) => {
  const dx = POT.x - s.x, dy = POT.y - s.y, len = Math.hypot(dx, dy);
  const k = Math.min(66 / Math.abs(dx / len || 1e-9), 26 / Math.abs(dy / len || 1e-9));
  // piles grow upward from their base: a seat above the pot takes its coins just below the badge
  return { x: s.x + (dx / len) * k, y: s.y + (dy / len) * k + 10 + 22 * Math.max(0, dy / len) };
});
const placeOf = (at) => (at.kind === "pot" ? POT : at.kind === "bet" ? BET[at.seat] : EDGE[at.seat]);
const pileEls = new Map(), flightEls = new Map();
function setPile(key, amount, spot, size) {
  let el = pileEls.get(key);
  if (!amount) { if (el) { el.remove(); pileEls.delete(key); } return; }
  if (!el) {
    el = document.createElement("div");
    el.className = "pile";
    el.innerHTML = `<span class="coinsbox"></span>`;
    el.style.left = `${spot.x}px`;
    el.style.top = `${spot.y}px`;
    layer.appendChild(el);
    pileEls.set(key, el);
  }
  if (el.dataset.amount !== String(amount)) {
    el.dataset.amount = String(amount);
    el.querySelector(".coinsbox").innerHTML = pileHTML(amount, size);
  }
}

// ---- the bet numbers: beside each pile; on the sweep they ride with the coins into the pot number ----
const pileWidth = (amount, size) => {
  let n = Math.max(0, Math.floor(amount)), cols = 0;
  for (const d of DENOMS) if (n >= d) { n -= Math.floor(n / d) * d; cols++; }
  cols = Math.min(cols, 5);
  return cols ? size + (cols - 1) * size * 0.5 : 0;
};
// a bet label's anchor: its left edge 5 px right of the pile, its middle level with the pile's base
const labelAt = (seat, amount) => ({ x: BET[seat].x + pileWidth(amount, BET_SIZE) / 2 + 5, y: BET[seat].y - 9 });
const labelEls = new Map(), flyLabelEls = new Map();
function amtEl(map, key, text) {
  let el = map.get(key);
  if (!el) { el = document.createElement("span"); el.className = "amt"; layer.appendChild(el); map.set(key, el); }
  if (el.textContent !== String(text)) el.textContent = text;
  return el;
}
function potNumber() {
  // the pot pill's number, in stage coordinates (the pill is centred on POT.x)
  const n = potPill.querySelector("b");
  return { x: POT.x - potPill.offsetWidth / 2 + n.offsetLeft + n.offsetWidth / 2, y: POT.y + 18 + n.offsetTop + n.offsetHeight / 2 };
}

function draw(m, hand, t) {
  // resting piles
  const keys = new Set([...m.piles.keys()]);
  for (const k of [...pileEls.keys()]) if (!keys.has(k)) setPile(k, 0);
  for (const [k, v] of m.piles) setPile(k, v, k === "pot" ? POT : BET[+k.slice(4)], k === "pot" ? POT_SIZE : BET_SIZE);
  // flights
  const live = new Set();
  for (const f of m.flights) {
    live.add(f.id);
    let el = flightEls.get(f.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "flight";
      el.innerHTML = f.kind === "column" ? `<span class="cstack" style="--sz:${BET_SIZE}px">${column(f.denom, f.count, BET_SIZE)}</span>` : pileHTML(f.amount, f.to.kind === "pot" ? BET_SIZE : POT_SIZE);
      layer.appendChild(el);
      flightEls.set(f.id, el);
    }
    const a = placeOf(f.from), b = placeOf(f.to), st = m.flightAt(f, t);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const x = a.x + (b.x - a.x) * st.s, y = a.y + (b.y - a.y) * st.s - Math.min(60, COIN.arc * dist) * st.lift;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${1 - 0.75 * st.sink})`;
    el.style.opacity = String(1 - st.sink);
  }
  for (const [id, el] of [...flightEls]) if (!live.has(id)) { el.remove(); flightEls.delete(id); }
  // the numbers: resting beside their piles …
  const restKeys = new Set();
  for (const [k, v] of m.piles) {
    if (k === "pot") continue;
    restKeys.add(k);
    const p = labelAt(+k.slice(4), v), el = amtEl(labelEls, k, v);
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(0, -50%)`;
    el.style.opacity = "1";
  }
  for (const [k, el] of [...labelEls]) if (!restKeys.has(k)) { el.remove(); labelEls.delete(k); }
  // … and swept: each rides with its coins and merges into the pot's number as they land
  const pn = potNumber(), flyKeys = new Set();
  for (const f of m.flights) {
    if (f.kind !== "pile" || f.from.kind !== "bet" || f.to.kind !== "pot" || f.landed) continue;
    flyKeys.add(f.id);
    const st = m.flightAt(f, t), a = labelAt(f.from.seat, f.amount);
    const dist = Math.hypot(pn.x - a.x, pn.y - a.y);
    const x = a.x + (pn.x - a.x) * st.s, y = a.y + (pn.y - a.y) * st.s - Math.min(60, COIN.arc * dist) * st.lift * 0.35;
    const fade = Math.min(1, Math.max(0, (st.u - 0.8) / 0.2));        // melts into the pot number over the last fifth
    const el = amtEl(flyLabelEls, f.id, f.amount);
    el.style.transform = `translate(${x}px, ${y}px) translate(${-50 * st.s}%, -50%) scale(${1 - 0.2 * fade})`;
    el.style.opacity = String(1 - fade);
  }
  for (const [id, el] of [...flyLabelEls]) if (!flyKeys.has(id)) { el.remove(); flyLabelEls.delete(id); }
  // badges, pot, street
  const b = badgesAt(hand, t);
  badges.forEach((el, i) => {
    el.querySelector(".stack").textContent = m.stackAt(i, t);
    el.querySelector(".say").textContent = b.say.get(i) || "";
    el.classList.toggle("folded", b.folded.has(i));
    el.classList.toggle("won", b.won.has(i));
  });
  const pot = m.potAt(t);
  potPill.querySelector("b").textContent = pot;
  potPill.style.opacity = pot ? "1" : "0.45";
  streetEl.textContent = b.street;
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
function seek(to) {
  // the engine is replayed from the start: tick(t) runs everything due up to t, in order
  m = build(hand);
  t = to;
  m.tick(t);
  cueAt = m.cues.length;
  draw(m, hand, t);
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
  draw(m, hand, t);
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
  for (const el of [...pileEls.values(), ...flightEls.values(), ...labelEls.values(), ...flyLabelEls.values()]) el.remove();
  pileEls.clear(); flightEls.clear(); labelEls.clear(); flyLabelEls.clear();
  $("play").textContent = "Play";
  seek(0);
});
function fit() {
  const k = Math.min(1.4, stage.parentElement.clientWidth / STAGE_W);   // may grow: the coins are the table's real (small) sizes
  stage.style.transform = `scale(${k})`;
  stage.parentElement.style.height = `${Math.round(STAGE_H * k)}px`;
}
window.addEventListener("resize", fit);
window.__coinPlay = play;
window.__coinSeek = seek;
fit();
seek(0);
