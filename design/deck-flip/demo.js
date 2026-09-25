// Deck-flip demo. Bundled with esbuild into demo.bundle.js (see build.sh); uses the real
// engine (src/lib/poker/deck3d.js) and the real card renderer (composer.js).
import { drawDeck, flipState, STAGE, FLIP_MS, W, H, T } from "../../src/lib/poker/deck3d.js";
import { renderBack, renderBoard } from "../../src/lib/poker/composer.js";

const BASE = "deck-parts/";
const RANKS = "A23456789TJQK", SUITS = "shdc";
const $ = (id) => document.getElementById(id);

// ---- card art: composer SVG → image (external hrefs inlined, an SVG image can't fetch) ----
const svgCache = new Map();
async function inline(markup) {
  let svg = markup.match(/<svg[\s\S]*<\/svg>/)[0];
  for (const [, file] of svg.matchAll(/href="\/deck-parts\/([^"]+)"/g)) {
    if (!svgCache.has(file)) {
      const txt = await (await fetch(BASE + file)).text();
      svgCache.set(file, "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(txt))));
    }
    svg = svg.replaceAll(`href="/deck-parts/${file}"`, `href="${svgCache.get(file)}"`);
  }
  return svg;
}
async function toImage(markup, px = 600) {
  const svg = (await inline(markup)).replace(/width="\d+" height="\d+"/, `width="${px}" height="${Math.round((px * H) / W)}"`);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  return img;
}
const randomCard = () => RANKS[Math.floor(Math.random() * 13)] + SUITS[Math.floor(Math.random() * 4)];
const cardName = (c) => ({ A: "Ace", T: "10", J: "Jack", Q: "Queen", K: "King" }[c[0]] || c[0]) + " of " + { s: "spades", h: "hearts", d: "diamonds", c: "clubs" }[c[1]];

// ---- stages ----------------------------------------------------------------------------
function stage(canvas, cardPx) {
  const scale = cardPx / W, dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${Math.round(STAGE.w * scale)}px`;
  canvas.style.height = `${Math.round(STAGE.h * scale)}px`;
  canvas.width = Math.round(STAGE.w * scale * dpr);
  canvas.height = Math.round(STAGE.h * scale * dpr);
  const ctx = canvas.getContext("2d");
  return { ctx, draw(st, art) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawDeck(ctx, st, art, { x: STAGE.side, y: STAGE.above });
  } };
}

// ---- readouts + curves ----------------------------------------------------------------
const fmt = (v, d = 2) => (Math.abs(v) < 5e-13 ? 0 : v).toFixed(d);
function readout(st, theta0) {
  const deg = ((st.theta - theta0) * 180) / Math.PI;
  $("r-theta").textContent = `${fmt(deg, 1)}°`;
  $("r-omega").textContent = `${fmt(st.omega)} rad/s`;
  $("r-omega2").textContent = `${fmt((st.omega * 180) / Math.PI, 0)}°/s`;
  $("r-alpha").textContent = `${fmt(st.alpha, 1)} rad/s²`;
  $("r-L").textContent = `${fmt(st.L * 1e4, 3)} ×10⁻⁴`;
  $("r-torque").textContent = `${fmt(st.torque * 1e4, 3)} ×10⁻⁴`;
  $("r-lift").textContent = `${fmt((st.lift - T / 2) * (63.5 / W), 1)} mm`;
  $("r-clear").textContent = `${fmt(st.clearance * (63.5 / W), 1)} mm`;
}
function drawCurves(u) {
  const cv = $("curves"), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const col = { grid: css.getPropertyValue("--grid"), theta: css.getPropertyValue("--c1"), omega: css.getPropertyValue("--c2"), alpha: css.getPropertyValue("--c3"), lift: css.getPropertyValue("--c4"), ink: css.getPropertyValue("--muted") };
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const X = (v) => pad.l + v * (w - pad.l - pad.r), mid = pad.t + (h - pad.t - pad.b) / 2, amp = (h - pad.t - pad.b) / 2;
  g.strokeStyle = col.grid; g.lineWidth = 1;
  g.beginPath(); g.moveTo(X(0), mid); g.lineTo(X(1), mid); g.stroke();
  for (const q of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(X(q), pad.t); g.lineTo(X(q), h - pad.b); g.stroke(); }
  const S = Array.from({ length: 201 }, (_, i) => flipState(i / 200));
  const maxW = Math.max(...S.map((s) => s.omega)), maxA = Math.max(...S.map((s) => Math.abs(s.alpha))), maxL = Math.max(...S.map((s) => s.lift - T / 2));
  const series = [
    ["theta", (s) => (s.theta / Math.PI) * 2 - 1],
    ["omega", (s) => (s.omega / maxW) * 2 - 1],
    ["alpha", (s) => s.alpha / maxA],
    ["lift", (s) => ((s.lift - T / 2) / maxL) * 2 - 1]
  ];
  g.lineWidth = 2;
  for (const [k, fn] of series) {
    g.strokeStyle = col[k]; g.beginPath();
    S.forEach((s, i) => { const x = X(i / 200), y = mid - fn(s) * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  g.strokeStyle = col.ink; g.lineWidth = 1.5; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(X(u), pad.t - 4); g.lineTo(X(u), h - pad.b + 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = col.ink; g.font = "11px system-ui, sans-serif"; g.textAlign = "center";
  [["start", 0], ["¼", 0.25], ["½", 0.5], ["¾", 0.75], [`${FLIP_MS / 1000} s`, 1]].forEach(([t, q]) => g.fillText(t, Math.min(Math.max(X(q), 14), w - 14), h - 4));
}

// ---- app -----------------------------------------------------------------------------
(async () => {
  const back = await toImage(renderBack(60));
  let faceCard = randomCard();
  let face = await toImage(renderBoard(faceCard, 60));
  const big = stage($("big"), 220), small = stage($("small"), 82);
  let theta0 = 0;                   // resting angle: 0 = face down, π = face up
  let anim = null, lastU = 0;
  const log = [];                   // per-frame record for verification
  window.__flipLog = log;
  window.__deckProbe = () => ({ theta0, animating: !!anim, faceCard, u: lastU });

  const render = (st) => {
    const art = { back, face };
    big.draw(st, art); small.draw(st, art);
    readout(st, theta0); drawCurves(st.u); lastU = st.u;
    $("face-name").textContent = Math.cos(st.theta) < 0 ? `Bottom card: ${cardName(faceCard)}` : "Top card: the Sylly red back";
  };
  const rest = () => flipState(0, { theta0 });
  render(rest());

  async function flip() {
    if (anim) return;
    if (Math.cos(theta0) > 0) { faceCard = randomCard(); face = await toImage(renderBoard(faceCard, 60)); }
    $("scrub").value = 0;
    log.length = 0;
    const speed = $("slow").checked ? 4 : 1;
    anim = { start: performance.now(), dur: FLIP_MS * speed };
    const tick = (now) => {
      const u = Math.min(1, (now - anim.start) / anim.dur);
      const st = flipState(u, { theta0 });
      log.push({ t: now - anim.start, u, theta: st.theta - theta0 });
      render(st);
      if (u < 1) requestAnimationFrame(tick);
      else { theta0 += Math.PI; anim = null; $("flip").textContent = Math.cos(theta0) > 0 ? "Flip face up" : "Flip face down"; render(rest()); }
    };
    requestAnimationFrame(tick);
  }
  $("flip").addEventListener("click", flip);
  $("scrub").addEventListener("input", (e) => { if (!anim) render(flipState(+e.target.value / 1000, { theta0 })); });
  window.__deckFlip = flip;
  window.addEventListener("resize", () => drawCurves(lastU));
})();
