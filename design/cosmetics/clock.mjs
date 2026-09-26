// The ring as the turn clock, at four moments of a turn.
import { ringSvg, ringBox } from "../../src/lib/cosmetics.js";
import { writeFileSync } from "node:fs";
const cell = (look, r, px) => `<div class="c"><span class="rw" style="width:${ringBox(px)}px;height:${ringBox(px)}px">${ringSvg(px, look, r)}<span class="av" style="width:${px}px;height:${px}px">YO</span></span><small>${Math.round(r * 100)}% left</small></div>`;
writeFileSync("clock.html", `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b1222;color:#9db0d6;font:13px system-ui;padding:20px;display:grid;gap:14px}
.row{display:flex;gap:26px}.c{display:grid;justify-items:center;gap:6px}.rw{position:relative;display:inline-grid;place-items:center}.rw svg{position:absolute;inset:0}
.av{position:relative;border-radius:50%;background:#a8567a;color:#fff;font-weight:700;display:grid;place-items:center;font-size:24px}</style>
${["default", "ruby", "riverstone"].map((l) => `<div class="row">${[1, 0.7, 0.4, 0.12].map((r) => cell(l, r, 64)).join("")}</div>`).join("")}`);
