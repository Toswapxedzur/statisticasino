// Regenerates design/deck-review/index.html from the real renderer (composer.js).
// Run from statisticasino/: node design/deck-review/build.mjs
import { renderDeck, renderBoard, deckBand } from '../../src/lib/poker/composer.js';
import fs from 'fs';
const rel = (s) => s.replaceAll('href="/deck-parts/', 'href="deck-parts/');
const pct = (c) => (deckBand(c) / 78 * 100).toFixed(1);
const full = deckBand(52) / 78;
const counts = [52, 26, 13, 5, 1];
const row = (w) => counts.map(c => `<figure><div class="obj">${rel(renderDeck(c, w))}</div><figcaption>${c} card${c > 1 ? 's' : ''}<span>band ${pct(c)}% of card height</span></figcaption></figure>`).join('')
  + `<figure><div class="obj">${rel(renderBoard('Ks', w))}</div><figcaption>a face card<span>for scale</span></figcaption></figure>`;
const html = `<meta charset="utf-8">
<title>Dealer Deck Stack</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,650&family=Hanken+Grotesk:wght@400;500;600&display=swap">
<style>
:root{--bg:#f5efe2;--surface:#fffaf0;--text:#14203b;--muted:#5b6784;--faint:#8a93a8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0b1222;--surface:#16213a;--text:#e5ecff;--muted:#93a3c6;--faint:#62708f}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0b1222;--surface:#16213a;--text:#e5ecff;--muted:#93a3c6;--faint:#62708f}
*{box-sizing:border-box}body{background:var(--bg);color:var(--text);font:15px/1.5 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding-inline:20px;padding-block:32px 60px;display:grid;gap:28px}
.eyebrow{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font:650 clamp(28px,4vw,38px)/1.1 Fraunces,Georgia,serif;margin:0;text-wrap:balance}
h2{font:600 20px/1.2 Fraunces,Georgia,serif;margin:0}
.lede{color:var(--muted);max-width:70ch;margin:0}.lede b{color:var(--text)}
.spec{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:0;padding:0;list-style:none}
.spec li{background:var(--surface);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--muted)}.spec b{display:block;color:var(--text);font-size:15px}
.ground{border-radius:16px;padding:26px 22px 18px;display:flex;flex-wrap:wrap;gap:26px 30px;align-items:flex-end;overflow-x:auto}
.dark{background:#0f172a;--cap:#93a3c6;--capb:#e5ecff}.light{background:#f1e9d8;--cap:#5b6784;--capb:#14203b}
figure{margin:0;display:grid;justify-items:center;gap:8px}
.obj .card-svg{display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35))}
figcaption{font-size:12px;text-align:center;display:grid;color:var(--capb);font-weight:600}figcaption span{font-weight:400;color:var(--cap)}
.zoom{justify-content:center}
</style>
<div class="wrap">
<header style="display:grid;gap:10px">
<div class="eyebrow">Bluffing Valley · deal animation · the dealer's deck</div>
<h1>A 52-card stack, drawn as one top card plus its edge</h1>
<p class="lede">Your spec: the top card at its <b>true flat shape</b>, the stack's <b>front edge</b> showing below it as thin <b>grey and white strips</b>, one per card, <b>shrinking as cards are dealt</b>. Revised: each card <b>30% thinner</b>, so a full deck's band is now <b>${full.toFixed(2)} × the card height</b> (was 0.30). Only the top card and the edge are drawn, not 52 cards. Everything below is the real renderer output (<code>renderDeck</code>), the same code the table will use.</p>
<ul class="spec"><li><b>Band at 52 cards</b>${deckBand(52).toFixed(1)} of 78 units = ${pct(52)}% of card height (was 30%)</li><li><b>One strip per card</b>${(deckBand(52) / 52).toFixed(3)} units (was 0.450): white edge over a grey gap (60 / 40)</li><li><b>Realism</b>rounded corners curve each strip up at its ends; seeded jitter ±0.25 and tone variation; soft shade toward the table</li><li><b>Top card</b>the live Sylly back, same frame as every face card</li></ul>
</header>
<h2>At table size (82 px, 6 seats or fewer)</h2>
<div class="ground dark">${row(82)}</div>
<div class="ground light">${row(82)}</div>
<h2>At 60 px (9–10 seats)</h2>
<div class="ground dark">${row(60)}</div>
<h2>Close-up of the full deck (320 px)</h2>
<div class="ground dark zoom"><figure><div class="obj">${rel(renderDeck(52, 320))}</div><figcaption>52 cards<span>strips visible at this size; at table size they read as a fine texture, like a real deck</span></figcaption></figure></div>
</div>`;
fs.writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('written', html.length, 'band@52', deckBand(52).toFixed(2), 'units =', pct(52) + '%');
