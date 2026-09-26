import { SPRINT } from "./sprint.js";
import { svg } from "./icons.js";
import { writeFileSync } from "node:fs";
const col = ([k, name, body]) => `<div class="c"><div class="big dark">${svg(body, 150)}</div><div class="big light">${svg(body, 150)}</div>
<div class="row"><div class="sm">${svg(body, 44)}<span>Sprint</span></div><div class="nav">${svg(body, 22)}<span>Sprint</span></div></div><h3>${name}</h3></div>`;
writeFileSync("sprint-sheet.html", `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700&display=swap" rel="stylesheet"><style>
body{margin:0;background:#0b1222;color:#e5ecff;font:14px "Hanken Grotesk",system-ui;padding:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.c{display:grid;gap:10px}.big{border-radius:14px;height:190px;display:grid;place-items:center}.dark{background:#111b33}.light{background:#e9eef8}
.row{display:flex;gap:10px}.sm{flex:1;background:#111b33;border-radius:12px;display:grid;justify-items:center;gap:6px;padding:10px;color:#9db0d6;font-weight:600;font-size:13px}
.nav{flex:1;background:#16213a;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:7px;color:#9db0d6;font-weight:600}
h3{margin:0;text-align:center;color:#9db0d6;font-size:15px}</style>${SPRINT.map(col).join("")}`);
