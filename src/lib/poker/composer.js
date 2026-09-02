// Riverside card helpers — OUR labels (rank+suit from the extracted glyphs,
// deck-parts.js) laid onto the Replay Poker deck.
//   · small cards (①/②) → our own composed card (big label + centre suit).
//   · #3 (board)         → Replay's card body (pips + court) with OUR label
//                          swapped into the corner (labelOverlay covers
//                          Replay's baked rank glyph and draws ours).
// Geometry matches the Replay deck: 60×78. Colours match Replay's pips.

import { PARTS } from "./deck-parts.js";

const W = 60, H = 78, CX = W / 2, CY = H / 2;
const INK = "#0a1428", RED = "#c81e2a"; // Replay's spade/club + heart/diamond
const SUITPART = { s: "suit-spade", c: "suit-club", h: "suit-heart", d: "suit-diamond" };
const SUITNAME = { s: "spade", c: "club", h: "heart", d: "diamond" };
const RANK_OK = new Set(["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]);

const f = (n) => Math.round(n * 100) / 100;
const rankPart = (r) => (r === "T" ? "rank-10" : `rank-${r}`);
const partW = (name, h) => (PARTS[name].vb[2] / PARTS[name].vb[3]) * h;
const colorOf = (suit) => (suit === "h" || suit === "d" ? RED : INK);

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

// our corner label — numeral over suit, left-aligned to the top-left corner
function cornerLabel(rank, suit, color, numH, suitH) {
  const pad = 4.5;
  const nw = partW(rankPart(rank), numH);
  const sw = partW(SUITPART[suit], suitH);
  const numCy = pad + numH / 2;
  return (
    place(rankPart(rank), pad + nw / 2, numCy, numH, color) +
    place(SUITPART[suit], pad + sw / 2 + 0.5, numCy + numH / 2 + suitH / 2 + 1, suitH, color)
  );
}
function numberCorner(rank, color, numH) {
  const pad = 4.5;
  const nw = partW(rankPart(rank), numH);
  return place(rankPart(rank), pad + nw / 2, pad + numH / 2, numH, color);
}

// ---- #3: our label overlay for a Replay 60×78 card ------------------------
// Returns an SVG fragment (a white cover over Replay's baked rank glyph + our
// corner label) to inject just before the Replay card's </svg>.
export function labelOverlay(card) {
  if (!card || card.length < 2) return "";
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!RANK_OK.has(rank) || !SUITNAME[suit]) return "";
  const color = colorOf(suit);
  const cover = `<rect x="1.5" y="1.5" width="17" height="26" rx="4" fill="#ffffff"/>`;
  return cover + cornerLabel(rank, suit, color, 13, 10);
}

// ---- small cards (① / ②) — our composed card ------------------------------
export function renderSmall(card, width) {
  if (!card || card.length < 2) return "";
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!RANK_OK.has(rank) || !SUITNAME[suit]) return "";
  const color = colorOf(suit);
  const d = width <= 48 ? 1 : 2;
  const numH = (22 * W) / width; // ~constant 22px on screen
  const w = Math.round(width), h = Math.round((width * H) / W);
  let inner =
    `<rect x="0.5" y="0.5" width="59" height="77" rx="6" fill="#fff" stroke="rgba(0,0,0,0.18)"/>` +
    place(SUITPART[suit], CX, 40, 30, color);
  const n = numberCorner(rank, color, numH);
  inner += d === 1 ? n : n + rot180(n);
  return `<span class="card-wrap"><svg class="card-svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${rank} ${SUITNAME[suit]}">${inner}</svg></span>`;
}

// which form for a given render width
export function formFor(width) {
  if (width <= 48) return 1; // our small — number in a corner + centre suit
  if (width <= 58) return 2; // our small — two diagonal numbers + centre suit
  if (width <= 104) return 3; // Replay body + our label
  return 4;                   // full Replay card
}
