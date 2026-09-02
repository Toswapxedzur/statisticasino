// Riverside OWN deck — composed from the extracted glyphs (deck-parts.js +
// court-*.svg), styled after the Replay Poker deck but made from our parts so
// we don't depend on the actual Replay art.
//   · small cards (①/②) → big label + centre suit.
//   · #3 (board)         → OUR card, Replay-style: small corner label + our
//                          suit-pips in the standard layout / our court figure.
// Geometry 60×78 (Replay ratio); colours match Replay (spade/club, heart/diamond).

import { PARTS } from "./deck-parts.js";

const W = 60, H = 78, CX = W / 2, CY = H / 2;
const INK = "#0a1428", RED = "#c81e2a";
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RANK_OK = new Set(["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]);

const f = (n) => Math.round(n * 100) / 100;
const rankPart = (r) => (r === "T" ? "rank-10" : `rank-${r}`);
const partW = (name, h) => (PARTS[name].vb[2] / PARTS[name].vb[3]) * h;
const colorOf = (s) => (s === "h" || s === "d" ? RED : INK);

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
const frame = () => `<rect x="0.5" y="0.5" width="59" height="77" rx="6" fill="#fff" stroke="rgba(0,0,0,0.18)"/>`;

// our corner label — numeral, suit directly below it, left-aligned
function cornerLabel(rank, suit, color, numH, suitH) {
  const pad = 4;
  const nw = partW(rankPart(rank), numH);
  const sw = partW(SUITPART[suit], suitH);
  const numCy = pad + numH / 2;
  return (
    place(rankPart(rank), pad + nw / 2, numCy, numH, color) +
    place(SUITPART[suit], pad + sw / 2 + 0.4, numCy + numH / 2 + suitH / 2 + 0.8, suitH, color)
  );
}
function numberCorner(rank, color, numH) {
  const nw = partW(rankPart(rank), numH);
  return place(rankPart(rank), 4 + nw / 2, 4 + numH / 2, numH, color);
}

// ---- #3 centre: our suit-pips (Replay-style layout) / ace / court ---------
const COL = { L: 20, C: CX, R: 40 };
const bandY = (t) => 14 + t * 50; // 14..64
const LAYOUT = {
  2: [["C", 0.06], ["C", 0.94]],
  3: [["C", 0.06], ["C", 0.5], ["C", 0.94]],
  4: [["L", 0.08], ["R", 0.08], ["L", 0.92], ["R", 0.92]],
  5: [["L", 0.08], ["R", 0.08], ["C", 0.5], ["L", 0.92], ["R", 0.92]],
  6: [["L", 0.08], ["R", 0.08], ["L", 0.5], ["R", 0.5], ["L", 0.92], ["R", 0.92]],
  7: [["L", 0.08], ["R", 0.08], ["C", 0.29], ["L", 0.5], ["R", 0.5], ["L", 0.92], ["R", 0.92]],
  8: [["L", 0.08], ["R", 0.08], ["C", 0.29], ["L", 0.5], ["R", 0.5], ["C", 0.71], ["L", 0.92], ["R", 0.92]],
  9: [["L", 0.06], ["R", 0.06], ["L", 0.36], ["R", 0.36], ["C", 0.5], ["L", 0.64], ["R", 0.64], ["L", 0.94], ["R", 0.94]],
  T: [["L", 0.06], ["R", 0.06], ["C", 0.22], ["L", 0.36], ["R", 0.36], ["L", 0.64], ["R", 0.64], ["C", 0.78], ["L", 0.94], ["R", 0.94]],
};
function centre(rank, suit, color) {
  if (rank === "A") return place(SUITPART[suit], CX, 40, 24, color);
  if (rank === "J" || rank === "Q" || rank === "K")
    // Replay's own court portrait (permitted), matched to its geometry, so the
    // courts look like Replay while our pips/labels stay ours.
    return `<image href="/replay-engine/assets/${rank}${suit}.png" x="21" y="8" width="35" height="66" preserveAspectRatio="xMidYMid meet"/>`;
  const spec = LAYOUT[rank];
  const pip = spec.length <= 5 ? 12 : spec.length <= 8 ? 10.5 : 9; // fit high counts
  return spec.map(([c, t]) => place(SUITPART[suit], COL[c], bandY(t), pip, color, t > 0.5 ? 180 : 0)).join("");
}

function svgWrap(inner, width) {
  const w = Math.round(width), h = Math.round((width * H) / W);
  return `<span class="card-wrap"><svg class="card-svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg></span>`;
}

// ---- #3: OUR OWN Replay-style board card ----------------------------------
export function renderBoard(card, width) {
  if (!card || card.length < 2) return "";
  const rank = card[0].toUpperCase(), suit = card[1].toLowerCase();
  if (!RANK_OK.has(rank) || !SUITNAME[suit]) return "";
  const color = colorOf(suit);
  return svgWrap(frame() + cornerLabel(rank, suit, color, 19, 15) + centre(rank, suit, color), width);
}

// ---- small cards (① / ②) --------------------------------------------------
export function renderSmall(card, width) {
  if (!card || card.length < 2) return "";
  const rank = card[0].toUpperCase(), suit = card[1].toLowerCase();
  if (!RANK_OK.has(rank) || !SUITNAME[suit]) return "";
  const color = colorOf(suit);
  const d = width <= 48 ? 1 : 2;
  const numH = (22 * W) / width;
  let inner = frame() + place(SUITPART[suit], CX, 40, 30, color);
  const n = numberCorner(rank, color, numH);
  inner += d === 1 ? n : n + rot180(n);
  return svgWrap(inner, width);
}

// which form for a given render width
export function formFor(width) {
  if (width <= 48) return 1;
  if (width <= 58) return 2;
  if (width <= 104) return 3;
  return 4;
}
