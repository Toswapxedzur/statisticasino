import { ICONS, svg } from "./icons.js";
import { writeFileSync } from "node:fs";
// lobby order: player-vs-player first (Hold'em, Big Two), then the house games
const ORDER = ["holdem", "big-two", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"];
const SHORT = { holdem: "Hold'em", "big-two": "Big Two", blackjack: "Blackjack", baccarat: "Baccarat", "three-card": "Three Card", roulette: "Roulette", "sic-bo": "Sic Bo", slots: "Slots" };
const COUNT = { holdem: "3 tables · 11 playing", "big-two": "1 table · 4 playing", blackjack: "2 tables · 5 playing", baccarat: "Start a table", "three-card": "Start a table", roulette: "1 table · 3 playing", "sic-bo": "Start a table", slots: "Start a table" };
const by = Object.fromEntries(ICONS.map(([k, , , body]) => [k, body]));
const games = ORDER.map((k) => ({ k, name: SHORT[k], body: by[k] }));
const A = (w) => `<div class="a ${w}">${games.map((g, i) => `<div class="pill ${i ? "" : "on"}">${svg(g.body, 26)}<span>${g.name}</span></div>`).join("")}</div>`;
const B = (w) => `<div class="b ${w}">${games.map((g, i) => `<div class="tab ${i ? "" : "on"}">${svg(g.body, 44)}<span>${g.name}</span></div>`).join("")}</div>`;
const C = (w) => `<div class="c ${w}">${games.map((g, i) => `<div class="tile ${i ? "" : "on"}">${svg(g.body, 58)}<div><b>${g.name}</b><small>${COUNT[g.k]}</small></div></div>`).join("")}</div>`;
const frame = (label, inner, width) => `<section><h2>${label}</h2><div class="frame" style="width:${width}px">${inner}</div></section>`;
writeFileSync("tabs-mock.html", `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700&display=swap" rel="stylesheet"><style>
body{margin:0;background:#0b1222;color:#e5ecff;font:14px "Hanken Grotesk",system-ui;padding:24px;display:grid;gap:26px}
h2{margin:0 0 10px;font-size:15px;color:#93a3c6;font-weight:600}
.frame{background:#0f172a;border-radius:14px;padding:16px;overflow:hidden}
.row{display:flex;gap:28px;align-items:flex-start}
.a{display:flex;gap:8px;overflow:hidden}.a.m{width:358px}
.pill{display:flex;align-items:center;gap:8px;padding:6px 14px 6px 8px;border-radius:999px;color:#93a3c6;font-weight:600;white-space:nowrap;flex:none}
.pill.on{background:#1e2c4c;color:#e5ecff}
.b{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.b.m{grid-template-columns:repeat(4,1fr);width:358px}
.tab{display:grid;justify-items:center;gap:6px;padding:10px 4px 8px;border-radius:12px;color:#93a3c6;font-weight:600;font-size:13px}
.tab.on{background:#1e2c4c;color:#e5ecff}
.c{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.c.m{grid-template-columns:repeat(2,1fr);width:358px}
.tile{display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;background:#16213a}
.tile.on{background:#23345c}
.tile b{display:block;font-size:15px}.tile small{color:#93a3c6;font-size:12px}
</style>
${frame("A · Icon + name pills, one scrolling row (closest to today)", `<div class="row">${A("d")}</div>`, 930)}
${frame("A on a phone (still scrolls sideways)", A("m"), 390)}
${frame("B · Icon-over-name tabs: one row of 8 on desktop", B("d"), 930)}
${frame("B on a phone: two rows of 4, nothing hidden", B("m"), 390)}
${frame("C · Game tiles with live table counts: 4×2 on desktop", C("d"), 930)}
${frame("C on a phone: 2×4", C("m"), 390)}
`);
