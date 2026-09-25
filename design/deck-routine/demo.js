// Deck-routine demo. Bundled with esbuild into demo.bundle.js (see build.sh); runs the real
// engine (deck3d.js), the real timeline (deck-routine.js) and the real card art (composer.js).
import { drawStack, W, H } from "../../src/lib/poker/deck3d.js";
import { buildRoutine } from "../../src/lib/poker/deck-routine.js";
import { renderBack, renderBoard } from "../../src/lib/poker/composer.js";

const BASE = "deck-parts/";
const $ = (id) => document.getElementById(id);
const STAGE_W = 700, STAGE_H = 420;                   // table units (a card is 60 wide)
const BAR = 28;                                        // the top bar
// the real game: face-up (used) pile top-right, face-down deck top-left, just below the bar
const START = { fx: 640, fy: 93 }, END = { fx: 60, fy: 93 }, CENTRE = { fx: 350, fy: 240 };

// ---- card art: composer SVG → image (external hrefs inlined; an SVG image can't fetch) ----
const cache = new Map();
async function inline(markup) {
  let svg = markup.match(/<svg[\s\S]*<\/svg>/)[0];
  for (const [, file] of svg.matchAll(/href="\/deck-parts\/([^"]+)"/g)) {
    if (!cache.has(file)) cache.set(file, "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(await (await fetch(BASE + file)).text()))));
    svg = svg.replaceAll(`href="/deck-parts/${file}"`, `href="${cache.get(file)}"`);
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
const RANKS = "A23456789TJQK", SUITS = "shdc";
const randomCard = () => RANKS[Math.floor(Math.random() * 13)] + SUITS[Math.floor(Math.random() * 4)];
const LABEL = { "fly-in": "Flies in, turns over, grows", settle: "Settles", "cut 1": "Middle cut 1 of 3", "cut 2": "Middle cut 2 of 3", "cut 3": "Middle cut 3 of 3", split: "Splits into two piles", shuffle: "Shuffle: cards to the third pile", "fly-back": "Flies to the deck spot, shrinks", pause: "", done: "Back in place" };

(async () => {
  const back = await toImage(renderBack(60, { edge: false }));
  let face = await toImage(renderBoard(randomCard(), 60, { edge: false }));
  let seed = Math.floor(Math.random() * 1e9);
  let R = buildRoutine({ start: START, end: END, centre: CENTRE, seed });

  const cv = $("stage"), ctx = cv.getContext("2d");
  let scale = 1, dpr = 1;
  function fit() {
    dpr = window.devicePixelRatio || 1;
    scale = Math.min(1.37, cv.parentElement.clientWidth / STAGE_W);   // 1.37 px/unit = 82 px cards
    cv.style.width = `${Math.round(STAGE_W * scale)}px`;
    cv.style.height = `${Math.round(STAGE_H * scale)}px`;
    cv.width = Math.round(STAGE_W * scale * dpr);
    cv.height = Math.round(STAGE_H * scale * dpr);
  }

  // timeline bar: one segment per phase, sized by duration
  function buildBar() {
    const bar = $("phases");
    bar.innerHTML = "";
    for (const p of R.phases) {
      if (p.name === "pause" || p.name === "settle") continue;
      const seg = document.createElement("span");
      seg.style.flexGrow = String(p.t1 - p.t0);
      seg.dataset.name = p.name;
      seg.textContent = p.name.replace("cut ", "cut ");
      bar.appendChild(seg);
    }
  }

  let t = 0, playing = false, last = 0;
  const log = [];
  window.__routineLog = log;
  window.__routineProbe = () => ({ t, duration: R.duration, playing, phase: R.frameAt(t).phase });

  function draw() {
    const f = R.frameAt(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    // the top bar, and the two spots just below it (faint outlines + labels)
    ctx.fillStyle = "rgba(147,163,198,0.10)";
    ctx.fillRect(0, 0, STAGE_W, BAR);
    ctx.fillStyle = "rgba(147,163,198,0.55)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("top bar", STAGE_W / 2, BAR / 2 + 3.5);
    ctx.strokeStyle = "rgba(147,163,198,0.28)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [spot, label] of [[END, "deck (face down)"], [START, "used pile (face up)"]]) {
      ctx.beginPath();
      ctx.roundRect(spot.fx - W / 2 - 4, spot.fy - H / 2 - 4, W + 8, H + 8, 9);
      ctx.stroke();
      ctx.fillText(label, spot.fx, spot.fy + H / 2 + 16);
    }
    ctx.setLineDash([]);
    for (const s of f.stacks) drawStack(ctx, s, { back, face });
    $("phase").textContent = LABEL[f.phase] ?? f.phase;
    $("time").textContent = `${(t / 1000).toFixed(2)} / ${(R.duration / 1000).toFixed(2)} s`;
    $("scrub").value = Math.round((t / R.duration) * 1000);
    for (const seg of $("phases").children) seg.classList.toggle("on", seg.dataset.name === f.phase);
  }

  function tick(now) {
    if (!playing) return;
    // cap one frame's step: after a hitch (hidden tab, slow frame) the routine resumes where it
    // was instead of skipping ahead — a late first frame once skipped the whole fly-in
    const dt = Math.min(50, Math.max(0, now - last));
    last = now;
    t = Math.min(R.duration, t + dt * +$("speed").value);
    log.push({ now, t, phase: R.frameAt(t).phase });
    draw();
    if (t < R.duration) requestAnimationFrame(tick);
    else { playing = false; $("play").textContent = "Play again"; }
  }
  async function play() {
    if (playing) { playing = false; $("play").textContent = "Resume"; return; }
    if (t >= R.duration) {
      // a fresh routine: new cut points and shuffle, a new face-up card to start
      seed = Math.floor(Math.random() * 1e9);
      R = buildRoutine({ start: START, end: END, centre: CENTRE, seed });
      face = await toImage(renderBoard(randomCard(), 60, { edge: false }));
      buildBar();
      t = 0;
    }
    log.length = 0;
    playing = true;
    $("play").textContent = "Pause";
    last = performance.now();
    requestAnimationFrame(tick);
  }
  $("play").addEventListener("click", play);
  $("scrub").addEventListener("input", (e) => { playing = false; $("play").textContent = t >= R.duration ? "Play again" : "Resume"; t = (+e.target.value / 1000) * R.duration; draw(); });
  window.addEventListener("resize", () => { fit(); draw(); });
  window.__routinePlay = play;
  fit(); buildBar(); draw();
})();
