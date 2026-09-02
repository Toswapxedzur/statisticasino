// Riverside card renderer.
//
// THE POINT (owner, hard-won): the rank number + suit must be BIG and readable
// on every card. A small card CANNOT just be a shrunk real card — the number
// goes tiny and the eye strains. So:
//   · small cards (hole)  → a composed card with a BIG number + BIG suit
//     (real extracted glyphs), like the owner's small-card reference. Nothing
//     else — there's no room, and none is needed.
//   · larger cards (board+) → the whole real Aguilar card (full pips + court +
//     enlarged index), which already reads well at that size.
// Back + empty are original Riverside art. Faces are white (real cards).

import { PARTS } from "./deck-parts.js";

const W = 63, H = 88, CX = W / 2, CY = H / 2;
const BLACK = "#000", RED = "#d40000";
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RR = { A: "01", "2": "02", "3": "03", "4": "04", "5": "05", "6": "06",
  "7": "07", "8": "08", "9": "09", T: "10", J: "11", Q: "12", K: "13" };

// widths at/below this render as the BIG-index small form; above → real card.
const HERO_MAX = 52;
// big-index sizes (viewBox units, of 88 tall) — deliberately large & readable
const NUM_H = 34, SUIT_H = 30;

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

function svgWrap(inner, width, cls, label) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  return `<svg class="rvcard ${cls}" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${inner}</svg>`;
}

// ---- public: a card face --------------------------------------------------
export function renderFace(card, { width = 62 } = {}) {
  if (!card || card.length < 2) return renderEmpty(width);
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!RR[rank] || !SUITNAME[suit]) return renderEmpty(width);
  const label = `${rank === "T" ? "10" : rank} of ${SUITNAME[suit]}s`;

  // larger cards → the whole real card
  if (width > HERO_MAX) {
    const w = Math.round(width), h = Math.round((width * H) / W);
    return `<img class="rvcard face" src="/cards/${suit}${RR[rank]}.svg" width="${w}" height="${h}" alt="${label}" draggable="false" />`;
  }

  // small cards → BIG number top-left + BIG suit tucked to its lower-right
  const color = suit === "h" || suit === "d" ? RED : BLACK;
  const pad = 6;
  const nw = partW(rankPart(rank), NUM_H);
  const numCx = pad + nw / 2;
  const numCy = pad + NUM_H / 2;
  const suitCx = numCx + nw / 2 + SUIT_H * 0.28;
  const suitCy = numCy + NUM_H / 2 + SUIT_H * 0.42;
  const inner =
    `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H - 1.2}" rx="6" fill="#fff" stroke="#cfcabd" stroke-width="0.7"/>` +
    place(rankPart(rank), numCx, numCy, NUM_H, color) +
    place(SUITPART[suit], suitCx, suitCy, SUIT_H, color);
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
  return svgWrap(inner, width, "back", "card back").replace('aria-label="card back"', 'aria-hidden="true"');
}

// ---- public: an empty slot ------------------------------------------------
export function renderEmpty(width = 62) {
  const inner = `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.3" stroke-dasharray="4 4"/>`;
  return svgWrap(inner, width, "empty", "").replace('aria-label=""', 'aria-hidden="true"');
}
