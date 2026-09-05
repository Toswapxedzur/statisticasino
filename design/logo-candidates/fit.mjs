import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const prof = process.argv[2] || "/tmp/rv-fit-prof";
const p = spawn(chrome, ["--headless=new", "--remote-debugging-port=9224", "--user-data-dir=" + prof, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target; for (let i = 0; i < 40; i++) { try { target = await (await fetch("http://127.0.0.1:9224/json/new?about:blank", { method: "PUT" })).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
const names = readdirSync(".").filter((f) => f.endsWith(".svg") && f !== "sheet.svg" && !f.startsWith("fit-")).map((f) => f.slice(0, -4));
const PAD = 14, fitted = [];
for (const n of names) {
  const raw = readFileSync(n + ".svg", "utf8");
  await send("Page.navigate", { url: "file://" + process.cwd() + "/" + n + ".svg" }); await sleep(400);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify((()=>{const b=document.getElementById('content').getBBox();return [b.x,b.y,b.width,b.height]})())", returnByValue: true });
  const [x, y, w, h] = JSON.parse(r.result.result.value);
  const k = Math.min((512 - 2 * PAD) / w, (512 - 2 * PAD) / h);
  const tx = 256 - k * (x + w / 2), ty = 256 - k * (y + h / 2);
  const svg = raw.replace('<g id="content">', '<g id="content" transform="translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + k.toFixed(4) + ')">');
  writeFileSync("fit-" + n + ".svg", svg); fitted.push([n, svg]);
  console.log(n, "bbox", [x, y, w, h].map(Math.round).join(","), "scale", k.toFixed(2));
}
const order = ["threaded-a","k-pierce","q-knot","seven-diamond","ten-coin","j-hook","clamp","fused","k-arms","hoop"];
fitted.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
let sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="2700" height="1180" viewBox="0 0 2700 1180"><rect width="2700" height="1180" fill="#e9eef8"/>';
fitted.forEach(([name, svg], i) => { const x = 20 + (i % 5) * 536, y = 20 + Math.floor(i / 5) * 580;
  sheet += '<g transform="translate(' + x + ' ' + y + ')">' + svg.replace(/^<svg[^>]*>/, '<svg width="512" height="512" viewBox="0 0 512 512">') + '</g>'
    + '<text x="' + (x + 256) + '" y="' + (y + 548) + '" text-anchor="middle" font-family="Helvetica" font-size="26" fill="#1a2742">' + (i + 1) + '. ' + name + '</text>'; });
writeFileSync("sheet.svg", sheet + "</svg>");
p.kill("SIGKILL"); console.log("sheet.svg written");
