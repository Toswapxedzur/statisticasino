// Riverside card composer — builds each card from the EXTRACTED real glyphs
// (Chris Aguilar "Vector Playing Cards 3.0", LGPL 3.0 — suits + numerals in
// deck-parts.js) laid out by our own size rule. Four designs, chosen by width:
//   ① smallest — hero: a big real numeral top-left + the suit 1.2× lower-right.
//   ② small    — ① + the opposite corner (rotated): the real-deck diagonal.
//   ③ medium   — "many symbols": the whole Aguilar card (real pips + court +
//                enlarged index), served from /cards/.
//   ④ large    — rank + suit in all four corners, open middle.
// Faces are white (real cards); the back + empty slot are original Riverside
// art. Output is an HTML string (SVG for ①②④, <img> for ③) for {@html}.

import { PARTS } from "./deck-parts.js";

const W = 63, H = 88, CX = W / 2, CY = H / 2;
const BLACK = "#000", RED = "#d40000";
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RR = { A: "01", "2": "02", "3": "03", "4": "04", "5": "05", "6": "06",
  "7": "07", "8": "08", "9": "09", T: "10", J: "11", Q: "12", K: "13" };

const f = (n) => Math.round(n * 100) / 100;
const rankPart = (r) => (r === "T" ? "rank-10" : `rank-${r}`);

// place a part centred at (cx,cy), scaled so its height = targetH, recoloured,
// optionally rotated about that centre.
function place(name, cx, cy, targetH, color, rot = 0) {
  const p = PARTS[name];
  if (!p) return "";
  const [vx, vy, vw, vh] = p.vb;
  const s = targetH / vh;
  const body = color ? p.body.replace(/fill="[^"]*"/g, `fill="${color}"`) : p.body;
  const r = rot ? ` rotate(${rot})` : "";
  return `<g transform="translate(${f(cx)} ${f(cy)})${r} scale(${f(s)}) translate(${f(-(vx + vw / 2))} ${f(-(vy + vh / 2))})">${body}</g>`;
}

// a corner index (numeral over suit), anchored to the left ("l") or right
// ("r") edge near the top. numH = numeral height; suit sits just below, 1.15×.
function indexUnit(rank, suit, color, side, numH) {
  const x = side === "l" ? 9 : W - 9;
  const suitH = numH * 1.15;
  return (
    place(rankPart(rank), x, 3 + numH / 2, numH, color) +
    place(SUITPART[suit], x, 3 + numH + suitH * 0.62, suitH, color)
  );
}
const rot180 = (inner) => `<g transform="rotate(180 ${CX} ${CY})">${inner}</g>`;

function frame() {
  return `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="#fff" stroke="#cfcabd" stroke-width="0.7"/>`;
}

function designFor(width) {
  if (width <= 52) return 1;
  if (width <= 58) return 2;
  if (width <= 104) return 3;
  return 4;
}

function svgWrap(inner, width, label) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  return `<svg class="rvcard face" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${inner}</svg>`;
}

// ---- public: a card face --------------------------------------------------
export function renderFace(card, { width = 62 } = {}) {
  if (!card || card.length < 2) return renderEmpty(width);
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!RR[rank] || !SUITNAME[suit]) return renderEmpty(width);
  const color = suit === "h" || suit === "d" ? RED : BLACK;
  const label = `${rank === "T" ? "10" : rank} of ${SUITNAME[suit]}s`;
  const d = designFor(width);

  // ③ — the full real card (pips / court / enlarged index)
  if (d === 3) {
    const w = Math.round(width), h = Math.round((width * H) / W);
    return `<img class="rvcard face" src="/cards/${suit}${RR[rank]}.svg" width="${w}" height="${h}" alt="${label}" draggable="false" />`;
  }

  let inner = frame();
  if (d === 1) {
    // hero: big numeral top-left, suit 1.2× lower-right
    inner += place(rankPart(rank), 19, 27, 38, color);
    inner += place(SUITPART[suit], 41, 60, 46, color);
  } else if (d === 2) {
    const tl = indexUnit(rank, suit, color, "l", 16);
    inner += tl + rot180(tl);
  } else {
    // ④ four corners, open middle
    const l = indexUnit(rank, suit, color, "l", 14);
    const r = indexUnit(rank, suit, color, "r", 14);
    inner += l + r + rot180(l) + rot180(r);
  }
  return svgWrap(inner, width, label);
}

// ---- public: the card back ------------------------------------------------
export function renderBack(width = 62) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  const gold = "#e6c260";
  const inner =
    `<defs><linearGradient id="rvb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#173463"/><stop offset="1" stop-color="#0b1a36"/></linearGradient></defs>` +
    `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="url(#rvb)"/>` +
    `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="4" fill="none" stroke="${gold}" stroke-opacity="0.85"/>` +
    `<rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="3" fill="none" stroke="${gold}" stroke-opacity="0.35" stroke-width="0.7"/>` +
    `<circle cx="${CX}" cy="${CY}" r="12" fill="#0b1a36" stroke="${gold}" stroke-opacity="0.7"/>` +
    place("suit-spade", CX, CY, 14, gold);
  return `<svg class="rvcard back" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

// ---- public: an empty slot ------------------------------------------------
export function renderEmpty(width = 62) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  return `<svg class="rvcard empty" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.3" stroke-dasharray="4 4"/></svg>`;
}

export { designFor };
