// Riverside vector deck — the poker table's own card faces.
//
// A self-contained SVG renderer (no PNGs, no external font, no async load) so
// cards are crisp at any size and never flash-in. INDEPENDENT of the shared
// static/replay-engine/cards.js used by the /data replay page — that deck
// keeps its classic look; this one is the redesigned felt's deck.
//
// The four sized designs (per the spec — the size rule made literal: the
// smaller the card, the bigger the number/symbol; the larger, the more
// symbols):
//   ① smallest  — one corner: number + suit. Nothing else.
//   ② small     — + the opposite corner (rotated). Reads from either side.
//   ③ medium    — many symbols: the real pip grid / ace / court panel.
//   ④ large     — number + suit in BOTH directions (four corners), open middle.
// The design is chosen from the render width, so one call adapts to any size.
//
// THEME-AWARE: every colour is a CSS variable (defined for dark + light in
// Card.svelte), so the deck follows the app's light/dark theme with no JS and
// switches live.
//
// Public API (mirrors the old renderer's shape so Card.svelte drops in):
//   renderFace(card, { width })  -> HTML string  (card = "As","Td","Jh"…)
//   renderBack({ width })        -> HTML string
//   renderEmpty({ width })       -> HTML string

const W = 60, H = 84, CX = W / 2, CY = H / 2;

// suit → its colour token (red suits vs "black" suits)
const RED = new Set(["h", "d"]);
const SUIT_NAME = { s: "spade", c: "club", h: "heart", d: "diamond" };

// ---- suit glyphs, authored in a 100-unit box centred on the origin --------
const GLYPH = {
  d: '<path d="M0,-46 L30,0 L0,46 L-30,0 Z"/>',
  h: '<path d="M0,40 C-8,26 -40,16 -40,-10 C-40,-30 -20,-40 -6,-30 C-2,-27 0,-22 0,-18 C0,-22 2,-27 6,-30 C20,-40 40,-30 40,-10 C40,16 8,26 0,40 Z"/>',
  s: '<path d="M0,-46 C-8,-30 -40,-18 -40,6 C-40,24 -22,34 -8,26 C-6,34 -12,40 -20,44 L20,44 C12,40 6,34 8,26 C22,34 40,24 40,6 C40,-18 8,-30 0,-46 Z"/>',
  c: '<circle cx="0" cy="-16" r="16"/><circle cx="-17" cy="8" r="16"/><circle cx="17" cy="8" r="16"/><path d="M-5,6 C-7,24 -12,36 -20,44 L20,44 C12,36 7,24 5,6 Z"/>',
};

function f(n) {
  return Math.round(n * 100) / 100;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// CSS vars carry the theme; the fallbacks are the dark palette, so a card
// still renders if it's used somewhere the tokens aren't defined.
function color(suit) {
  return RED.has(suit) ? "var(--rvc-red,#ff5b52)" : "var(--rvc-ink,#e7eef9)";
}

// place a suit glyph centred at (x,y), visual height ≈ size, rotated rot°
function pip(suit, x, y, size, col, rot = 0) {
  const k = size / 100;
  const r = rot ? ` rotate(${rot})` : "";
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(k)})${r}" style="fill:${col}">${GLYPH[suit]}</g>`;
}

function rankLabel(rank) {
  return rank === "T" ? "10" : rank;
}

// rank font — a condensed display face ("poker number" look). Loaded via the
// app's Google Fonts link; falls back to the app grotesk. `renderFace` can
// pass a `font` override (used by the bake-off preview).
const DEFAULT_FAMILY = "'Oswald','Hanken Grotesk',sans-serif";
function fontAttr(family) {
  return `font-family="${family || DEFAULT_FAMILY}" font-weight="700"`;
}

// one index block (rank + suit) anchored to the top-left ("start") or
// top-right ("end") corner, with the SUIT offset down-and-inward from the
// rank and drawn `suitR`× the rank size (default 1.2 — suit bigger than the
// number). Rotate the whole card 180° to reach the bottom corners.
function idxBlock(rank, suit, col, idxFont, anchor, suitR = 1.2, family) {
  const label = rankLabel(rank);
  const two = label.length > 1;
  const rf = two ? idxFont * 0.82 : idxFont;
  const gs = idxFont * suitR;
  const pad = 5;
  const ls = two ? ' letter-spacing="-2"' : "";
  const ry = pad + rf * 0.8;
  const F0 = fontAttr(family);
  if (anchor === "end") {
    const rx = W - pad;
    return (
      `<text x="${rx}" y="${f(ry)}" text-anchor="end" ${F0} font-size="${f(rf)}" style="fill:${col}"${ls}>${esc(label)}</text>` +
      pip(suit, rx - rf * 0.45, ry + gs * 0.45, gs, col)
    );
  }
  return (
    `<text x="${pad}" y="${f(ry)}" ${F0} font-size="${f(rf)}" style="fill:${col}"${ls}>${esc(label)}</text>` +
    pip(suit, pad + rf * 0.55, ry + gs * 0.45, gs, col)
  );
}

// design ① — the hero: a big rank top-left and a bigger suit (1.2×) to its
// lower-right, together filling most of the card.
function hero(rank, suit, col, family) {
  const label = rankLabel(rank);
  const two = label.length > 1;
  const N = two ? 30 : 37;
  const gs = N * 1.2;
  const ry = 7 + N * 0.8;
  const ls = two ? ' letter-spacing="-3"' : "";
  return (
    `<text x="7" y="${f(ry)}" ${fontAttr(family)} font-size="${N}" style="fill:${col}"${ls}>${esc(label)}</text>` +
    pip(suit, two ? 39 : 37, ry + gs * 0.42, gs, col)
  );
}
function rot180(inner) {
  return `<g transform="rotate(180 ${CX} ${CY})">${inner}</g>`;
}

// ---- pip layouts for ③ (fractions of the pip band) ------------------------
const COL = { L: 20, C: 30, R: 40 };
function pipY(t) {
  return 16 + t * 52; // band y = 16..68
}
const LAYOUT = {
  2: [["C", 0.06], ["C", 0.94]],
  3: [["C", 0.06], ["C", 0.5], ["C", 0.94]],
  4: [["L", 0.1], ["R", 0.1], ["L", 0.9], ["R", 0.9]],
  5: [["L", 0.1], ["R", 0.1], ["C", 0.5], ["L", 0.9], ["R", 0.9]],
  6: [["L", 0.1], ["R", 0.1], ["L", 0.5], ["R", 0.5], ["L", 0.9], ["R", 0.9]],
  7: [["L", 0.1], ["R", 0.1], ["C", 0.3], ["L", 0.5], ["R", 0.5], ["L", 0.9], ["R", 0.9]],
  8: [["L", 0.1], ["R", 0.1], ["C", 0.3], ["L", 0.5], ["R", 0.5], ["C", 0.7], ["L", 0.9], ["R", 0.9]],
  9: [["L", 0.08], ["R", 0.08], ["L", 0.36], ["R", 0.36], ["C", 0.5], ["L", 0.64], ["R", 0.64], ["L", 0.92], ["R", 0.92]],
  T: [["L", 0.08], ["R", 0.08], ["C", 0.24], ["L", 0.36], ["R", 0.36], ["L", 0.64], ["R", 0.64], ["C", 0.76], ["L", 0.92], ["R", 0.92]],
};
function pipGrid(rank, suit, col, g) {
  const spec = LAYOUT[rank];
  if (!spec) return "";
  return spec.map(([c, t]) => pip(suit, COL[c], pipY(t), g, col, t > 0.5 ? 180 : 0)).join("");
}

// a framed court for J / Q / K (used only at ③)
function court(rank, suit, col) {
  const px = 11, py = 13, pw = W - 22, ph = H - 26, r = 5;
  return (
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${r}" style="fill:var(--rvc-panel,#27385a);stroke:${col}" stroke-width="1"/>` +
    `<line x1="${px}" y1="${CY}" x2="${px + pw}" y2="${CY}" style="stroke:${col}" stroke-opacity="0.16" stroke-width="1"/>` +
    `<g opacity="0.1">${pip(suit, CX, CY, 36, col)}</g>` +
    `<text x="${CX}" y="${CY - 1}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="27" style="fill:${col}">${rank}</text>` +
    pip(suit, CX, py + 8, 8, col) +
    pip(suit, CX, py + ph - 8, 8, col, 180)
  );
}

function frame() {
  const r = 6;
  return (
    `<defs><linearGradient id="rvfc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--rvc-face-a,#20304e)"/><stop offset="1" style="stop-color:var(--rvc-face-b,#111c31)"/></linearGradient></defs>` +
    `<rect x="0.7" y="0.7" width="${W - 1.4}" height="${H - 1.4}" rx="${r}" style="fill:url(#rvfc);stroke:var(--rvc-edge,#38496b)" stroke-width="1.2"/>` +
    `<rect x="2.7" y="2.7" width="${W - 5.4}" height="${H - 5.4}" rx="${r - 1.5}" fill="none" style="stroke:var(--rvc-inner,#ffffff14)" stroke-width="0.8"/>`
  );
}

// width → which of the four designs (and the index size). Tuned so the felt's
// real sizes land on the designs that matter: hole ~42 ⇒ ① (the bold hero),
// community ~62 ⇒ ③ (pips). ② and ④ ride other sizes.
function designFor(width) {
  if (width <= 52) return { d: 1 };
  if (width <= 58) return { d: 2, idxF: 22 };
  if (width <= 104) return { d: 3, idxF: 15 };
  return { d: 4, idxF: 16 };
}

// ---- public: a card face --------------------------------------------------
export function renderFace(card, { width = 62, font } = {}) {
  if (!card || card.length < 2) return renderEmpty({ width });
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  if (!SUIT_NAME[suit]) return renderEmpty({ width });
  const col = color(suit);
  const { d, idxF } = designFor(width);

  let inner = frame();

  if (d === 1) {
    inner += hero(rank, suit, col, font);
  } else if (d === 2) {
    const tl = idxBlock(rank, suit, col, idxF, "start", 1.2, font);
    inner += tl + rot180(tl);
  } else if (d === 3) {
    // pips carry the "many symbols"; keep the corner index compact so the
    // rank stays clear and doesn't fight the grid.
    const tl = idxBlock(rank, suit, col, idxF, "start", 0.8, font);
    inner += tl + rot180(tl);
    if (rank === "A") {
      inner += `<circle cx="${CX}" cy="${CY}" r="16" fill="none" style="stroke:${col}" stroke-opacity="0.15" stroke-width="1"/>` + pip(suit, CX, CY, 30, col);
    } else if (rank === "J" || rank === "Q" || rank === "K") {
      inner += court(rank, suit, col);
    } else {
      inner += pipGrid(rank, suit, col, 11);
    }
  } else {
    // ④ — four corners, open middle (per spec)
    const tl = idxBlock(rank, suit, col, idxF, "start", 1.2, font);
    const tr = idxBlock(rank, suit, col, idxF, "end", 1.2, font);
    inner += tl + tr + rot180(tl) + rot180(tr);
  }

  return svg(inner, width, `${rankLabel(rank)} of ${SUIT_NAME[suit]}s`);
}

// ---- public: the card back (theme-independent — backs stay dark) ----------
export function renderBack({ width = 62 } = {}) {
  const g1 = "#173463", g2 = "#0b1a36", gold = "#e6c260";
  const inner =
    `<defs><linearGradient id="rvbk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/></linearGradient>` +
    `<clipPath id="rvclip"><rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="3"/></clipPath></defs>` +
    `<rect x="0.7" y="0.7" width="${W - 1.4}" height="${H - 1.4}" rx="6" fill="url(#rvbk)"/>` +
    `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="4" fill="none" stroke="${gold}" stroke-opacity="0.85" stroke-width="1"/>` +
    `<rect x="6.5" y="6.5" width="${W - 13}" height="${H - 13}" rx="3" fill="none" stroke="${gold}" stroke-opacity="0.35" stroke-width="0.7"/>` +
    `<g clip-path="url(#rvclip)"><g stroke="${gold}" stroke-opacity="0.12" stroke-width="0.6">${lattice()}</g></g>` +
    `<circle cx="${CX}" cy="${CY}" r="11" fill="#0b1a36" stroke="${gold}" stroke-opacity="0.7" stroke-width="1"/>` +
    pip("s", CX, CY, 15, gold);
  return svg(inner, width, "card back", "back");
}
function lattice() {
  let s = "";
  for (let i = -H; i < W + H; i += 7) {
    s += `<line x1="${i}" y1="0" x2="${i + H}" y2="${H}"/><line x1="${i + H}" y1="0" x2="${i}" y2="${H}"/>`;
  }
  return s;
}

// ---- public: an empty slot ------------------------------------------------
export function renderEmpty({ width = 62 } = {}) {
  const inner = `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.3" stroke-dasharray="4 4"/>`;
  return svg(inner, width, "", "empty");
}

function svg(inner, width, label, cls = "") {
  const w = Math.round(width);
  const h = Math.round((width * H) / W);
  const c = cls ? ` ${cls}` : "";
  const aria = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return (
    `<span class="card-wrap${c}" style="width:${w}px;height:${h}px">` +
    `<svg class="card-svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"${aria}>${inner}</svg>` +
    `</span>`
  );
}
