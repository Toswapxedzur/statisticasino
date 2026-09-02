// Riverside card renderer — FOUR size forms, big readable index on every one.
//
// THE POINT (owner, hard-won): the rank number + suit must be BIG & readable at
// every card size (~constant on-screen size). You switch the FORM by size, you
// never shrink the number. Forms (small → large):
//   ① number + suit stacked in the top-left corner (nothing else).
//   ② one suit in the CENTRE + the number in two diagonal corners.
//   ③ top-left index only + spread pips / court (no bottom-right number).
//   ④ the full real Aguilar card (both indices + full pips + court).
// ①②③ are composed from the extracted real glyphs (deck-parts.js + court-*.svg);
// ④ is the whole /cards/ card. Back + empty are original art.

import { PARTS } from "./deck-parts.js";

const W = 63, H = 88, CX = W / 2, CY = H / 2;
const BLACK = "#000", RED = "#d40000";
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RR = { A: "01", "2": "02", "3": "03", "4": "04", "5": "05", "6": "06",
  "7": "07", "8": "08", "9": "09", T: "10", J: "11", Q: "12", K: "13" };

// constant on-screen index size (px), held across sizes
const NUM_PX = 22, SUIT_PX = 20;

const f = (n) => Math.round(n * 100) / 100;
const rankPart = (r) => (r === "T" ? "rank-10" : `rank-${r}`);
const partW = (name, h) => (PARTS[name].vb[2] / PARTS[name].vb[3]) * h;

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

// top-left corner: big numeral, suit tucked to its lower-right (withSuit)
function cornerBig(rank, suit, color, numH, suitH, withSuit = true) {
  const pad = 5.5;
  const nw = partW(rankPart(rank), numH);
  const numCx = pad + nw / 2, numCy = pad + numH / 2;
  let out = place(rankPart(rank), numCx, numCy, numH, color);
  if (withSuit) out += place(SUITPART[suit], numCx + nw / 2 + suitH * 0.25, numCy + numH / 2 + suitH * 0.4, suitH, color);
  return out;
}
// number only at a corner (for ②) — left ('l') edge; rotate for the diagonal
function numberCorner(rank, color, numH) {
  const pad = 5.5;
  const nw = partW(rankPart(rank), numH);
  return place(rankPart(rank), pad + nw / 2, pad + numH / 2, numH, color);
}

// ---- spread pip grid + court for ③ ---------------------------------------
const COL = { L: 17, C: CX, R: 46 };
const bandY = (t) => 26 + t * 40; // 26..66
const LAYOUT = {
  2: [["C", 0.05], ["C", 0.95]],
  3: [["C", 0.05], ["C", 0.5], ["C", 0.95]],
  4: [["L", 0.08], ["R", 0.08], ["L", 0.92], ["R", 0.92]],
  5: [["L", 0.08], ["R", 0.08], ["C", 0.5], ["L", 0.92], ["R", 0.92]],
  6: [["L", 0.08], ["R", 0.08], ["L", 0.5], ["R", 0.5], ["L", 0.92], ["R", 0.92]],
  7: [["L", 0.08], ["R", 0.08], ["C", 0.29], ["L", 0.5], ["R", 0.5], ["L", 0.92], ["R", 0.92]],
  8: [["L", 0.08], ["R", 0.08], ["C", 0.29], ["L", 0.5], ["R", 0.5], ["C", 0.71], ["L", 0.92], ["R", 0.92]],
  9: [["L", 0.06], ["R", 0.06], ["L", 0.37], ["R", 0.37], ["C", 0.5], ["L", 0.63], ["R", 0.63], ["L", 0.94], ["R", 0.94]],
  T: [["L", 0.06], ["R", 0.06], ["C", 0.22], ["L", 0.37], ["R", 0.37], ["L", 0.63], ["R", 0.63], ["C", 0.78], ["L", 0.94], ["R", 0.94]],
};
function centre(rank, suit, color) {
  if (rank === "A") return place(SUITPART[suit], CX, 46, 30, color);
  if (rank === "J" || rank === "Q" || rank === "K")
    return `<image href="/deck-parts/court-${rank}${suit}.svg" x="10" y="16" width="43" height="60" preserveAspectRatio="xMidYMid meet"/>`;
  const spec = LAYOUT[rank];
  return spec.map(([c, t]) => place(SUITPART[suit], COL[c], bandY(t), 12, color, t > 0.5 ? 180 : 0)).join("");
}

function frame() {
  return `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="#fff" stroke="#cfcabd" stroke-width="0.7"/>`;
}
function designFor(width) {
  if (width <= 48) return 1;
  if (width <= 60) return 2;
  if (width <= 104) return 3;
  return 4;
}
function svgWrap(inner, width, cls, label) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="rvcard ${cls}" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" ${aria}>${inner}</svg>`;
}

// ---- public: a card face --------------------------------------------------
export function renderFace(card, { width = 62 } = {}) {
  if (!card || card.length < 2) return renderEmpty(width);
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!RR[rank] || !SUITNAME[suit]) return renderEmpty(width);
  const label = `${rank === "T" ? "10" : rank} of ${SUITNAME[suit]}s`;
  const d = designFor(width);

  if (d === 4) {
    const w = Math.round(width), h = Math.round((width * H) / W);
    return `<img class="rvcard face" src="/cards/${suit}${RR[rank]}.svg" width="${w}" height="${h}" alt="${label}" draggable="false" />`;
  }

  const color = suit === "h" || suit === "d" ? RED : BLACK;
  const numH = (NUM_PX * W) / width, suitH = (SUIT_PX * W) / width;
  let inner = frame();
  if (d === 1) {
    inner += cornerBig(rank, suit, color, numH, suitH);
  } else if (d === 2) {
    inner += place(SUITPART[suit], CX, CY, 38, color);
    const n = numberCorner(rank, color, numH);
    inner += n + rot180(n);
  } else {
    inner += cornerBig(rank, suit, color, numH, suitH) + centre(rank, suit, color);
  }
  return svgWrap(inner, width, "face", label);
}

// ---- public: the card back ------------------------------------------------
export function renderBack(width = 62) {
  const gold = "#e6c260";
  const inner =
    `<defs><linearGradient id="rvb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#173463"/><stop offset="1" stop-color="#0b1a36"/></linearGradient></defs>` +
    `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="url(#rvb)"/>` +
    `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="4" fill="none" stroke="${gold}" stroke-opacity="0.85"/>` +
    `<rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="3" fill="none" stroke="${gold}" stroke-opacity="0.35" stroke-width="0.7"/>` +
    `<circle cx="${CX}" cy="${CY}" r="12" fill="#0b1a36" stroke="${gold}" stroke-opacity="0.7"/>` +
    place("suit-spade", CX, CY, 14, gold);
  return svgWrap(inner, width, "back", "");
}

// ---- public: an empty slot ------------------------------------------------
export function renderEmpty(width = 62) {
  const inner = `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.3" stroke-dasharray="4 4"/>`;
  return svgWrap(inner, width, "empty", "");
}

export { designFor };
