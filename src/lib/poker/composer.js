// Riverside card composer — cards built from the EXTRACTED real glyphs (Chris
// Aguilar "Vector Playing Cards 3.0", LGPL 3.0; suits + numerals in
// deck-parts.js, court figures in /deck-parts/court-*.svg).
//
// SIZE RULE (the real one — see memory card-legibility-constant-glyph): the
// rank number + suit stay a CONSTANT readable size on screen at every card
// size; we switch the layout FORM by width, we do NOT scale the glyph.
//   ① smallest — number + suit stacked in the top-left corner, nothing else.
//   ② small    — one suit in the CENTRE + the number in two diagonal corners.
//   ③ medium   — top-left index ONLY (no bottom-right number) + a COMPACT pip
//                cluster / court figure (Replay-style).
//   ④ largest  — the full standard card (both indices + full pips/court).
// Faces are white; back + empty are original Riverside art.

import { PARTS } from "./deck-parts.js";

const W = 63, H = 88, CX = W / 2, CY = H / 2;
const BLACK = "#000", RED = "#d40000";
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RR = { A: "01", "2": "02", "3": "03", "4": "04", "5": "05", "6": "06",
  "7": "07", "8": "08", "9": "09", T: "10", J: "11", Q: "12", K: "13" };

// constant on-screen index size (px): held put across card sizes
const NUM_PX = 16, SUIT_PX = 15;

const f = (n) => Math.round(n * 100) / 100;
const rankPart = (r) => (r === "T" ? "rank-10" : `rank-${r}`);
const partW = (name, h) => (PARTS[name].vb[2] / PARTS[name].vb[3]) * h; // scaled width for height h

// place a part centred at (cx,cy), height = targetH (viewBox units), recolour, rotate.
function place(name, cx, cy, targetH, color, rot = 0) {
  const p = PARTS[name];
  if (!p) return "";
  const [vx, vy, vw, vh] = p.vb;
  const s = targetH / vh;
  const body = color ? p.body.replace(/fill="[^"]*"/g, `fill="${color}"`) : p.body;
  const r = rot ? ` rotate(${rot})` : "";
  return `<g transform="translate(${f(cx)} ${f(cy)})${r} scale(${f(s)}) translate(${f(-(vx + vw / 2))} ${f(-(vy + vh / 2))})">${body}</g>`;
}
const rot180 = (inner) => `<g transform="rotate(180 ${CX} ${CY})">${inner}</g>`;

// a top-left corner index: numeral left-aligned near the corner, suit tucked
// to its lower-right. numH/suitH in viewBox units (already size-constant).
function cornerIndex(rank, suit, color, numH, suitH, withSuit = true) {
  const pad = 4.5;
  const nw = partW(rankPart(rank), numH);
  const numCx = pad + nw / 2;
  const numCy = pad + numH / 2;
  let out = place(rankPart(rank), numCx, numCy, numH, color);
  if (withSuit) out += place(SUITPART[suit], numCx + nw / 2 + 0.3, numCy + numH / 2 + suitH / 2 - 0.5, suitH, color);
  return out;
}

// ---- compact pip grid for ③ / ④ (number cards) ---------------------------
const COL = { L: 19, C: CX, R: 44 };
const bandY = (t) => 24 + t * 40; // 24..64
const LAYOUT = {
  2: [["C", 0.08], ["C", 0.92]],
  3: [["C", 0.08], ["C", 0.5], ["C", 0.92]],
  4: [["L", 0.1], ["R", 0.1], ["L", 0.9], ["R", 0.9]],
  5: [["L", 0.1], ["R", 0.1], ["C", 0.5], ["L", 0.9], ["R", 0.9]],
  6: [["L", 0.1], ["R", 0.1], ["L", 0.5], ["R", 0.5], ["L", 0.9], ["R", 0.9]],
  7: [["L", 0.1], ["R", 0.1], ["C", 0.3], ["L", 0.5], ["R", 0.5], ["L", 0.9], ["R", 0.9]],
  8: [["L", 0.1], ["R", 0.1], ["C", 0.3], ["L", 0.5], ["R", 0.5], ["C", 0.7], ["L", 0.9], ["R", 0.9]],
  9: [["L", 0.08], ["R", 0.08], ["L", 0.36], ["R", 0.36], ["C", 0.5], ["L", 0.64], ["R", 0.64], ["L", 0.92], ["R", 0.92]],
  T: [["L", 0.08], ["R", 0.08], ["C", 0.24], ["L", 0.36], ["R", 0.36], ["L", 0.64], ["R", 0.64], ["C", 0.76], ["L", 0.92], ["R", 0.92]],
};
function pips(rank, suit, color) {
  const spec = LAYOUT[rank];
  if (!spec) return "";
  return spec.map(([c, t]) => place(SUITPART[suit], COL[c], bandY(t), 9, color, t > 0.5 ? 180 : 0)).join("");
}
// centre content for ③/④: ace = one big suit, court = figure image, else pips
function centre(rank, suit, color) {
  if (rank === "A") return place(SUITPART[suit], CX, 44, 26, color);
  if (rank === "J" || rank === "Q" || rank === "K")
    return `<image href="/deck-parts/court-${rank}${suit}.svg" x="9" y="13" width="45" height="62" preserveAspectRatio="xMidYMid meet"/>`;
  return pips(rank, suit, color);
}

function frame() {
  return `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="#fff" stroke="#cfcabd" stroke-width="0.7"/>`;
}
function designFor(width) {
  if (width <= 48) return 1;
  if (width <= 58) return 2;
  if (width <= 104) return 3;
  return 4;
}
function svgWrap(inner, width, label) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  return `<svg class="rvcard face" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="${label}">${inner}</svg>`;
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

  // ④ — the full standard card (both indices + full pips/court), as-is
  if (d === 4) {
    const w = Math.round(width), h = Math.round((width * H) / W);
    return `<img class="rvcard face" src="/cards/${suit}${RR[rank]}.svg" width="${w}" height="${h}" alt="${label}" draggable="false" />`;
  }

  // constant-size index (viewBox units scale ~1/width → constant on screen)
  const numH = (NUM_PX * W) / width, suitH = (SUIT_PX * W) / width;
  let inner = frame();

  if (d === 1) {
    inner += cornerIndex(rank, suit, color, numH, suitH); // TL only
  } else if (d === 2) {
    inner += place(SUITPART[suit], CX, CY, 36, color);          // centre suit
    const n = cornerIndex(rank, suit, color, numH, suitH, false); // number only
    inner += n + rot180(n);                                       // two diagonal corners
  } else {
    // ③ — top-left index only + compact centre
    inner += cornerIndex(rank, suit, color, numH, suitH) + centre(rank, suit, color);
  }
  return svgWrap(inner, width, label);
}

// ---- public: the card back ------------------------------------------------
export function renderBack(width = 62) {
  const w = Math.round(width), h = Math.round((width * H) / W), gold = "#e6c260";
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
