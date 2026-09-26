import { ICONS, svg } from "./icons.js";
import { writeFileSync } from "node:fs";
const tile = (bg, size) => ICONS.map(([k, name, note, body]) => `<div class="t" style="background:${bg}">${svg(body, size)}<span style="color:${bg === "#111b33" ? "#93a3c6" : "#5b6784"}">${name}</span></div>`).join("");
writeFileSync("sheet.html", `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b1222;font:13px system-ui;padding:16px;display:grid;gap:14px}.row{display:grid;grid-template-columns:repeat(8,1fr);gap:10px}.t{border-radius:12px;padding:14px 6px 10px;display:grid;justify-items:center;gap:8px}</style>
<div class="row">${tile("#111b33", 96)}</div><div class="row">${tile("#eef1f6", 96)}</div><div class="row">${tile("#111b33", 32)}</div>`);
