// Riverside logo candidates — coins + suits + rank glyphs in faux-3D.
// Flat colours only (no gradients): depth = extruded offset copies in darker
// tone, lit = a clipped brighter region. Glyphs = our Aguilar parts; coins =
// our tier palette.
import { PARTS } from "/Users/fengyue.john.zhu/Desktop/programme/web/casin/statisticasino/src/lib/poker/deck-parts.js";
import { writeFileSync } from "node:fs";

const T = {
  copper: { base: "#c1691f", hi: "#eda45e", lo: "#71390c" },
  brass: { base: "#d9a520", hi: "#f6d878", lo: "#805c0a" },
  silver: { base: "#c6cdda", hi: "#ffffff", lo: "#79808f" },
  gold: { base: "#f5b60d", hi: "#ffe485", lo: "#8f6503" },
  rose: { base: "#e8879b", hi: "#ffd3db", lo: "#8f3f50" },
  platinum: { base: "#9cc8ec", hi: "#e4f3ff", lo: "#4d7ba3" },
  ruby: { base: "#d63c48", hi: "#ff9aa1", lo: "#7c1a22" },
  sapphire: { base: "#2f66d8", hi: "#8fb0f2", lo: "#16337e" },
  emerald: { base: "#17a35c", hi: "#7be7ab", lo: "#07512b" },
  obsidian: { base: "#3b2754", hi: "#7a5aa8", lo: "#180e26" },
  riverstone: { base: "#1fbfa4", hi: "#96f4e2", lo: "#0a5f50" },
  ivory: { base: "#f3efe6", hi: "#ffffff", lo: "#a89f8c" },
  navy: { base: "#1a2742", hi: "#31456e", lo: "#0b1222" }
};
const NAVY = "#0f172a";
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
let uid = 0;

// Orthographic projection of a plane rotated Rx(alpha)·Ry(beta) (degrees).
function plane(alpha, beta) {
  const a = rad(alpha), b = rad(beta);
  return {
    m: [Math.cos(b), Math.sin(b) * Math.sin(a), 0, Math.cos(a)],          // [a b c d] of matrix()
    n: [Math.sin(b), -Math.cos(b) * Math.sin(a)],                          // projected normal (toward viewer)
    facing: Math.cos(a) * Math.cos(b)                                      // >0 front face visible
  };
}
const mat = (m, x, y) => `matrix(${m.map(f).join(" ")} ${f(x)} ${f(y)})`;

// A glyph (suit / rank part) in its local plane, centred at origin, height h.
function glyphLocal(name, h, color, rot = 0, bold = 0) {
  const p = PARTS[name];
  const [vx, vy, vw, vh] = p.vb;
  const s = h / vh;
  const body = p.body.replace(/fill="[^"]*"/g, `fill="${color}"`);
  const st = bold ? ` stroke="${color}" stroke-width="${f(bold / s)}" stroke-linejoin="round"` : "";
  return `<g transform="rotate(${rot}) scale(${f(s)}) translate(${f(-(vx + vw / 2))} ${f(-(vy + vh / 2))})"${st}>${body}</g>`;
}

// Extruded glyph at (x,y): plane tilt (alpha,beta), depth d (px), in-plane rot.
function glyph3d(name, x, y, h, pal, { alpha = 0, beta = 0, depth = 10, rot = 0, bold = 0, lit = true } = {}) {
  const P = plane(alpha, beta);
  const steps = Math.max(1, Math.round(depth));
  let out = "";
  for (let k = steps; k >= 1; k--) {
    const ox = -P.n[0] * k, oy = -P.n[1] * k;
    out += `<g transform="${mat(P.m, x + ox, y + oy)}">${glyphLocal(name, h, pal.lo, rot, bold)}</g>`;
  }
  const id = `lit${uid++}`;
  out += `<g transform="${mat(P.m, x, y)}">${glyphLocal(name, h, pal.base, rot, bold)}`;
  if (lit) {
    out += `<clipPath id="${id}"><circle cx="${f(-h * 0.55)}" cy="${f(-h * 0.55)}" r="${f(h * 0.72)}"/></clipPath>`
      + `<g clip-path="url(#${id})">${glyphLocal(name, h, pal.hi, rot, bold)}</g>`;
  }
  return out + `</g>`;
}

// Coin: radius r, tilt = ry/rx (1 = face-on, 0.3 = edge-on-ish), in-plane
// rotation rot (deg) rotates the tilt axis, thickness t, form 1..3.
function coin(x, y, r, pal, { tilt = 0.7, rot = 0, t = 0.28, form = 3, face = null, facePal = null } = {}) {
  const th = r * t;
  const id = `clit${uid++}`;
  const inner = pal.lo, tri1 = pal.lo, tri2 = darker(pal.lo);
  const rh = (a, b) => `<polygon points="0,${f(-r * 0.35)} ${f(-r * 0.35)},0 0,${f(r * 0.35)}" fill="${a}"/><polygon points="0,${f(-r * 0.35)} ${f(r * 0.35)},0 0,${f(r * 0.35)}" fill="${b}"/>`;
  const faceG = (mul) => `${form >= 2 ? `<circle r="${f(r * 0.67)}" fill="${mul(inner)}"/>` : ""}`
    + (face ? `${glyphLocal(face, r * 0.9, mul((facePal || pal).hi))}` : form >= 3 ? rh(mul(tri1), mul(tri2)) : "");
  const lit = (c) => lighten(c, 0.3);
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot})">`
    + `<rect x="${f(-r)}" y="0" width="${f(2 * r)}" height="${f(th)}" fill="${darker(pal.lo)}"/>`
    + `<ellipse cx="0" cy="${f(th)}" rx="${f(r)}" ry="${f(r * tilt)}" fill="${darker(pal.lo)}"/>`
    + `<g transform="scale(1 ${f(tilt)})">`
    + `<circle r="${f(r)}" fill="${pal.base}"/>${faceG((c) => c)}`
    + `<clipPath id="${id}"><circle cx="${f(-r * 0.83)}" cy="${f(-r * 0.83)}" r="${f(r * 1.13)}"/></clipPath>`
    + `<g clip-path="url(#${id})"><circle r="${f(r)}" fill="${lit(pal.base)}"/>${faceG(lit)}</g>`
    + `</g></g>`;
}
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function toHex(r, g, b) { return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
function lighten(c, k) { const [r, g, b] = hex(c); return toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k); }
function darker(c, k = 0.35) { const [r, g, b] = hex(c); return toHex(r * (1 - k), g * (1 - k), b * (1 - k)); }

// Flat card tile (rounded rect) in a tilted plane, with a glyph on it.
function tile3d(x, y, w, h, pal, glyphName, gPal, { alpha = 0, beta = 0, depth = 8, rot = 0 } = {}) {
  const P = plane(alpha, beta);
  let out = "";
  const rect = (c) => `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(w * 0.1)}" fill="${c}"/>`;
  for (let k = depth; k >= 1; k--) out += `<g transform="${mat(P.m, x - P.n[0] * k, y - P.n[1] * k)} rotate(${rot})">${rect(pal.lo)}</g>`;
  out += `<g transform="${mat(P.m, x, y)}"><g transform="rotate(${rot})">${rect(pal.base)}${glyphLocal(glyphName, h * 0.6, gPal.base)}</g></g>`;
  return out;
}

const wrap = (inner, bg = NAVY) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`
  + `<rect width="512" height="512" rx="72" fill="${bg}"/><g id="content">${inner}</g></svg>`;

const C = [];
// Round 4 — same 1 rank + 1 suit + ≤2 coins knots, but SPREAD to the corners so
// the whole tile is filled (a fit pass then scales each mark to the tile edges).
const clipG = (shape, inner) => { const id = "w" + uid++; return "<clipPath id=\"" + id + "\">" + shape + "</clipPath><g clip-path=\"url(#" + id + ")\">" + inner + "</g>"; };
const rect = (x, y, w, h) => "<rect x=\"" + x + "\" y=\"" + y + "\" width=\"" + w + "\" height=\"" + h + "\"/>";
const poly = (pts) => "<polygon points=\"" + pts + "\"/>";
const weave = (A, B, region) => A + B + clipG(region, A);

// 1. Threaded A — A spans the tile; coin through the counter runs corner to corner; heart in the bottom-right corner.
{
  const A = glyph3d("rank-A", 236, 262, 440, T.gold, { alpha: 12, beta: -24, depth: 28, bold: 9 });
  const c = coin(330, 230, 190, T.sapphire, { tilt: 0.32, rot: -52, form: 2, t: 0.22 });
  const heart = glyph3d("suit-heart", 392, 400, 170, T.ruby, { alpha: 8, beta: 26, depth: 14, rot: 14 });
  C.push(["threaded-a", wrap(weave(c, A, rect(0, 300, 512, 212)) + heart)]);
}
// 2. K pierce — coin fills the height, K runs through it corner to corner; heart top-right.
{
  const c = coin(300, 262, 250, T.gold, { tilt: 0.3, rot: 78, form: 2, t: 0.16 });
  const K = glyph3d("rank-K", 210, 270, 430, T.silver, { alpha: 10, beta: 30, depth: 28, rot: -8, bold: 9 });
  const heart = glyph3d("suit-heart", 420, 120, 150, T.ruby, { alpha: 20, beta: -30, depth: 14, rot: 22 });
  C.push(["k-pierce", wrap(weave(K, c, rect(0, 0, 250, 512)) + heart)]);
}
// 3. Q knot — Q fills the left/centre, club threads the bowl from the top-right, coin in the bottom-right corner.
{
  const Q = glyph3d("rank-Q", 220, 240, 430, T.riverstone, { alpha: 10, beta: -22, depth: 28, rot: 0, bold: 9 });
  const club = glyph3d("suit-club", 330, 170, 260, T.ivory, { alpha: 16, beta: 34, depth: 16, rot: -14 });
  const c = coin(400, 410, 110, T.gold, { tilt: 0.55, rot: -30, form: 3, t: 0.3 });
  C.push(["q-knot", wrap(weave(club, Q, rect(0, 250, 512, 262)) + c)]);
}
// 4. Seven diamond — 7 spans corner to corner, diamond speared low-right, coin on the bar top-left.
{
  const seven = glyph3d("rank-7", 270, 262, 450, T.ruby, { alpha: 8, beta: 28, depth: 30, rot: 8, bold: 9 });
  const dia = glyph3d("suit-diamond", 330, 330, 300, T.gold, { alpha: 14, beta: -34, depth: 18, rot: -10 });
  const c = coin(120, 96, 100, T.silver, { tilt: 0.42, rot: -14, form: 3, t: 0.3 });
  C.push(["seven-diamond", wrap(weave(dia, seven, poly("120,330 512,330 512,512 120,512")) + c)]);
}
// 5. Ten coin — 10 spans the width, coin on the 0, heart across the bottom-left.
{
  const ten = glyph3d("rank-10", 256, 236, 380, T.gold, { alpha: 10, beta: -26, depth: 28, rot: -4, bold: 9 });
  const c = coin(380, 236, 160, T.sapphire, { tilt: 0.42, rot: 34, form: 2, t: 0.26 });
  const heart = glyph3d("suit-heart", 150, 380, 230, T.ruby, { alpha: 18, beta: 30, depth: 16, rot: 18 });
  C.push(["ten-coin", wrap(weave(c, ten, rect(256, 0, 256, 512)) + heart)]);
}
// 6. J hook — J top-right to bottom-left, spade skewered top-left, coin cradled bottom-right.
{
  const J = glyph3d("rank-J", 290, 250, 450, T.sapphire, { alpha: 10, beta: 28, depth: 30, rot: 10, bold: 9 });
  const spade = glyph3d("suit-spade", 190, 190, 280, T.ivory, { alpha: 14, beta: -30, depth: 16, rot: -12 });
  const c = coin(200, 420, 110, T.gold, { tilt: 0.5, rot: 20, form: 3, t: 0.3 });
  C.push(["j-hook", wrap(weave(spade, J, rect(0, 0, 512, 200)) + c)]);
}
// 7. Clamp — two coins at the left and right edges, the 8 fills the height between them, club through the loops.
{
  const c1 = coin(140, 250, 190, T.gold, { tilt: 0.3, rot: 70, form: 2, t: 0.2 });
  const c2 = coin(380, 262, 190, T.riverstone, { tilt: 0.3, rot: -68, form: 2, t: 0.2 });
  const eight = glyph3d("rank-8", 256, 256, 440, T.ivory, { alpha: 12, beta: 0, depth: 28, rot: -8, bold: 9 });
  const club = glyph3d("suit-club", 270, 262, 230, T.emerald, { alpha: 20, beta: 34, depth: 14, rot: 16 });
  C.push(["clamp", wrap(c1 + weave(eight, c2, rect(0, 200, 512, 312)) + weave(club, eight, rect(0, 180, 512, 150)))]);
}
// 8. Fused — coin corner to corner behind, A fills the height, heart fused at the bottom-right.
{
  const c = coin(256, 256, 280, T.gold, { tilt: 0.26, rot: -40, form: 2, t: 0.14 });
  const A = glyph3d("rank-A", 220, 262, 450, T.ivory, { alpha: 10, beta: 24, depth: 28, rot: -6, bold: 9 });
  const heart = glyph3d("suit-heart", 340, 330, 300, T.ruby, { alpha: 16, beta: -30, depth: 18, rot: 12 });
  C.push(["fused", wrap(c + weave(A, heart, rect(0, 0, 512, 330)))]);
}
// 9. K arms — K fills the height, diamond in the arms reaching the right edge, coin threaded over the stem at the left edge.
{
  const K = glyph3d("rank-K", 236, 256, 450, T.gold, { alpha: 12, beta: -26, depth: 30, rot: 0, bold: 9 });
  const dia = glyph3d("suit-diamond", 360, 262, 290, T.sapphire, { alpha: 10, beta: 32, depth: 18, rot: -8 });
  const c = coin(130, 262, 130, T.ruby, { tilt: 0.34, rot: 64, form: 2, t: 0.22 });
  C.push(["k-arms", wrap(weave(dia, K, rect(0, 262, 512, 250)) + weave(c, K, rect(60, 0, 190, 512)))]);
}
// 10. Hoop — Q fills the tile, coin hoop through the bowl spanning the width, spade in the bottom-right corner.
{
  const Q = glyph3d("rank-Q", 250, 240, 450, T.ivory, { alpha: 10, beta: 22, depth: 30, rot: 0, bold: 9 });
  const c = coin(256, 230, 220, T.gold, { tilt: 0.22, rot: 90, form: 2, t: 0.18 });
  const spade = glyph3d("suit-spade", 400, 410, 170, T.navy, { alpha: 12, beta: -30, depth: 14, rot: -16 });
  C.push(["hoop", wrap(weave(c, Q, rect(0, 230, 512, 282)) + spade)]);
}


// PICKED (2026-09-05): Q left, spade right, both facing IN (turned toward the centre),
// obsidian coin lying down below. Cyan Q, white spade, light-blue tile; thick extrusion.
{
  const LIGHT_BLUE = "#b7dcf7";
  const Q = glyph3d("rank-Q", 150, 200, 400, T.riverstone, { alpha: 8, beta: 38, depth: 50, rot: 0, bold: 15 });
  const spade = glyph3d("suit-spade", 385, 205, 350, T.ivory, { alpha: 8, beta: -38, depth: 34, rot: 0 });
  const c = coin(262, 440, 140, T.obsidian, { tilt: 0.42, rot: 0, form: 3, t: 0.5 });
  C.push(["q-spade-final", wrap(c + Q + spade, LIGHT_BLUE)]);
}
for (const [name, svg] of C) writeFileSync(`${name}.svg`, svg);
console.log("raw candidates written");
