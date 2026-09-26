// The cosmetics sheet — drawn from the game's own module (src/lib/cosmetics.js).
import { LOOKS, ringSvg, ringBox, plateStyle } from "../../src/lib/cosmetics.js";
import { writeFileSync } from "node:fs";
const avatar = (px, col, txt) => `<span class="av" style="width:${px}px;height:${px}px;background:${col};font-size:${Math.round(px * 0.36)}px">${txt}</span>`;
const withRing = (key, px, col, txt) => `<span class="rw" style="width:${ringBox(px)}px;height:${ringBox(px)}px">${ringSvg(px, key)}${avatar(px, col, txt)}</span>`;
const plate = (key) => { const p = plateStyle(key);
  return `<div class="plate" style="background:${p.bg}">${withRing(key, 28, "#4d6fb8", "MI")}<div class="txt"><div class="r1"><b style="color:${p.ink}">Milo</b><span style="color:${p.money}">12,480</span></div><div class="r3" style="color:${p.sub}">Call 40</div></div></div>`; };
const kk = (n) => (n >= 1e6 ? n / 1e6 + "M" : n >= 1e3 ? n / 1e3 + "K" : "start");
const row = (title, cell) => `<h3>${title}</h3><div class="grid">${LOOKS.map((l) => `<div class="cell">${cell(l)}</div>`).join("")}</div>`;
writeFileSync("sheet.html", `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet"><style>
body{margin:0;background:#0b1222;color:#e5ecff;font:14px "Hanken Grotesk",system-ui;padding:22px;display:grid;gap:12px}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:10px}
.cell{background:#0f172a;border-radius:14px;padding:12px 6px;display:grid;justify-items:center;align-content:center;gap:8px}
.cell h4{margin:0;font-size:13px;color:#9db0d6}.cell small{color:#62708f;font-size:11px}
.rw{position:relative;display:inline-grid;place-items:center}.rw svg{position:absolute;inset:0}.rw .av{position:relative}
.av{border-radius:50%;display:grid;place-items:center;font-weight:700;color:#fff}
.plate{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.plate .r1{display:flex;gap:6px;align-items:baseline}.plate b{font-size:13px}.plate .r1 span{font-size:13px;font-weight:700}.plate .r3{font-size:11px}
h3{margin:6px 0 0;font-size:14px;color:#9db0d6;font-weight:600}
</style>
${row("Rings — band 65% of the avatar's radius", (l) => `${withRing(l.key, 64, "#4d6fb8", "MI")}<h4>${l.name}</h4><small>${kk(l.at)}</small>`)}
${row("At the table: ring on a 28 px avatar · badge = the seat plate", (l) => plate(l.key))}
${row("Your own seat (36 px avatar)", (l) => withRing(l.key, 36, "#a8567a", "YO"))}`);
