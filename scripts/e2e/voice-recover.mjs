// Two headless Chromes (fake mics) on one table. Phase 1: both reach "connected".
// Phase 2: B (the answerer) silently kills its peer connection; A (offerer) must notice
// and recover via ICE restart, and B must end up connected again on a fresh connection.
// Phase 3: force A into the relay-only rebuild path via the dev hook; both must reconnect.
import { spawn } from "node:child_process";
const [TOK_A, TOK_B, TABLE, BASE = "http://localhost:5273"] = process.argv.slice(2);
const host = new URL(BASE).hostname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser(port, prof, token) {
  const p = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + prof, "--no-first-run", "--window-size=1440,900", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  let target; for (let i = 0; i < 40; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); break; } catch { await sleep(250); } }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === "Runtime.consoleAPICalled" && ["error","warning"].includes(d.params.type)) logs.push(d.params.args.map((a) => a.value || a.description).join(" ").slice(0, 160)); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  await send("Network.setCookie", { name: "casino_session", value: token, domain: host, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { p, send, evalJs, logs };
}
const STATE = `[...document.querySelectorAll('.voice-bar .peer')].map(p=>p.title).join(',') || (document.querySelector('.voice-bar')?.textContent.trim().replace(/\\s+/g,' ').slice(0,60))`;
const A = await browser(9231, "/tmp/vprofA", TOK_A), B = await browser(9232, "/tmp/vprofB", TOK_B);
for (const b of [A, B]) await b.send("Page.navigate", { url: `${BASE}/table/${TABLE}` });
for (let i = 0; i < 40; i++) { await sleep(1000); const ok = await A.evalJs(`!![...document.querySelectorAll('.voice-bar button')].find(x=>/join voice/i.test(x.textContent))`); const okb = await B.evalJs(`!![...document.querySelectorAll('.voice-bar button')].find(x=>/join voice/i.test(x.textContent))`); if (ok && okb) { console.log(`voice bar up after ${i + 1}s`); break; } }
for (const b of [A, B]) { console.log("join:", await b.evalJs(`(()=>{const btn=[...document.querySelectorAll('.voice-bar button')].find(x=>/join voice/i.test(x.textContent)); if(!btn) return 'NO BUTTON'; btn.click(); return 'ok'})()`)); await sleep(800); }
async function waitBoth(label, secs) {
  for (let i = 0; i < secs; i++) {
    await sleep(1000);
    const sa = await A.evalJs(STATE), sb = await B.evalJs(STATE);
    if (i % 3 === 0 || (sa === "connected" && sb === "connected")) console.log(`${label} t+${i + 1}s  A:${sa}  B:${sb}`);
    if (sa === "connected" && sb === "connected") return true;
  }
  return false;
}
const ids = async (b) => b.evalJs(`JSON.stringify({me: window.__voice?._myId, peers: [...(window.__voice?._pcs.keys()||[])], offerer: [...(window.__voice?._meta.values()||[])].map(m=>m.offerer)})`);
console.log("PHASE 1 initial connect:", await waitBoth("p1", 20) ? "PASS" : "FAIL");
console.log("A:", await ids(A), " B:", await ids(B));
// Which side is the answerer? Kill its pc without telling anyone.
const aInfo = JSON.parse(await ids(A));
const victim = aInfo.offerer[0] ? B : A, other = victim === B ? A : B;
console.log("PHASE 2: killing the answerer's peer connection (", victim === B ? "B" : "A", ")");
console.log("killed:", await victim.evalJs(`(()=>{const v=window.__voice; const pc=[...v._pcs.values()][0]; pc.close(); return pc.connectionState})()`));
const t0 = Date.now();
// First the other side must NOTICE (leave "connected"), then both must come back.
let noticed = false;
for (let i = 0; i < 45 && !noticed; i++) { await sleep(1000); const s = await other.evalJs(STATE); if (s !== "connected") { noticed = true; console.log(`p2 offerer noticed after ${i + 1}s: ${s}`); } }
if (!noticed) console.log("p2 offerer never noticed the dead connection (45s)");
const ok2 = noticed && await waitBoth("p2", 60);
console.log("PHASE 2 recover after kill:", ok2 ? `PASS in ${Math.round((Date.now() - t0) / 1000)}s` : "FAIL");
console.log("A:", await ids(A), " B:", await ids(B));
// Phase 3: offerer rebuilds relay-only (attempt index 1).
const offerer = victim === B ? A : B;
console.log("PHASE 3: forcing relay-only rebuild on the offerer; hasTurn =", await offerer.evalJs(`window.__voice._hasTurn()`));
await offerer.evalJs(`(()=>{const v=window.__voice; const id=[...v._pcs.keys()][0]; const m=v._meta.get(id); m.attempts=1; v._closePeer(id,{forget:false}); v._connectTo(id, m.name, true, {relay:true, reset:true}); return 'ok'})()`);
const t1 = Date.now();
const ok3 = await waitBoth("p3", 30);
await sleep(2000);
const cand = await offerer.evalJs(`(async()=>{const pc=[...window.__voice._pcs.values()][0]; const st=await pc.getStats(); let sel=null; const pairs=[]; st.forEach(r=>{ if(r.type==='transport'&&r.selectedCandidatePairId) sel=st.get(r.selectedCandidatePairId); if(r.type==='candidate-pair') pairs.push(r.state+(r.nominated?'*':'')); }); if(!sel){ st.forEach(r=>{ if(r.type==='candidate-pair'&&r.state==='succeeded') sel=r; }); } if(!sel) return 'no pair; pairs='+pairs.join(',')+' conn='+pc.connectionState+' ice='+pc.iceConnectionState+' policy='+pc.getConfiguration().iceTransportPolicy; const l=st.get(sel.localCandidateId), r=st.get(sel.remoteCandidateId); return 'local='+l.candidateType+'('+(l.address||'')+') remote='+r.candidateType+' policy='+pc.getConfiguration().iceTransportPolicy+' bytesSent='+sel.bytesSent})()`);
console.log("PHASE 3 relay rebuild:", ok3 ? `PASS in ${Math.round((Date.now() - t1) / 1000)}s` : "FAIL", "| path:", cand);
console.log("A errors:", A.logs.slice(0, 3)); console.log("B errors:", B.logs.slice(0, 3));
A.p.kill("SIGKILL"); B.p.kill("SIGKILL");
void other;
