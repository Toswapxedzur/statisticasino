// Cosmetics (owner's spec, 2026-09-26) — shared by the server (unlocks, validation) and the client
// (drawing). Two slots:
//   ring  — a band round the avatar, 65% of the avatar's radius thick, with rhombuses floating in it
//           (each two triangles, as on the coin). Band = the look's three darker shades, rhombuses =
//           its three lighter shades (always lighter than the band); all lit from the upper left in
//           hard steps.
//   badge — the seat plate's colour: three hard diagonal steps (lit upper-left → shaded lower-right).
// Everyone owns the default (the six warm chess tones). A metal unlocks — ring AND badge — once the
// player's highest-ever wealth (wallet + chips on tables) reaches its milestone; unlocks never lapse.
// Design sheet: design/cosmetics/.

export const CHESS = { ebony: "#1C1A15", charcoal: "#3E3A31", gray: "#6E685B", white: "#FBF8EF", cream: "#F1E9D3", ivory: "#E1D3AD" };

/** The metals (the coins' own colours, src/lib/poker/chips.js) at the owner's wealth milestones. */
export const METALS = [
  // all eleven coin metals, in the coins' order (owner, 2026-09-26: "where is copper and silver?");
  // everyone starts with 10K, so the first three come quickly
  { key: "copper", name: "Copper", at: 12_500, base: "#c1691f", hi: "#eda45e", lo: "#71390c" },
  { key: "brass", name: "Brass", at: 15_000, base: "#d9a520", hi: "#f6d878", lo: "#805c0a" },
  { key: "silver", name: "Silver", at: 20_000, base: "#c6cdda", hi: "#ffffff", lo: "#79808f" },
  { key: "gold", name: "Gold", at: 25_000, base: "#f5b60d", hi: "#ffe485", lo: "#8f6503" },
  { key: "rose", name: "Rose", at: 40_000, base: "#e8879b", hi: "#ffd3db", lo: "#8f3f50" },
  { key: "platinum", name: "Platinum", at: 60_000, base: "#9cc8ec", hi: "#e4f3ff", lo: "#4d7ba3" },
  { key: "ruby", name: "Ruby", at: 100_000, base: "#d63c48", hi: "#ff9aa1", lo: "#7c1a22" },
  { key: "sapphire", name: "Sapphire", at: 250_000, base: "#2f66d8", hi: "#8fb0f2", lo: "#16337e" },
  { key: "emerald", name: "Emerald", at: 1_000_000, base: "#17a35c", hi: "#7be7ab", lo: "#07512b" },
  { key: "obsidian", name: "Obsidian", at: 5_000_000, base: "#3b2754", hi: "#7a5aa8", lo: "#180e26" },
  { key: "riverstone", name: "Riverstone", at: 25_000_000, base: "#1fbfa4", hi: "#96f4e2", lo: "#0a5f50" }
];
/** Every look, default first: { key, name, at } (at = the wealth milestone; 0 = owned from the start). */
export const LOOKS = [{ key: "default", name: "Chess", at: 0 }, ...METALS.map(({ key, name, at }) => ({ key, name, at }))];
export const isLook = (key) => LOOKS.some((l) => l.key === key);
/** The looks a player owns, from their highest-ever wealth. */
export const ownedLooks = (peak) => LOOKS.filter((l) => (peak ?? 0) >= l.at).map((l) => l.key);

// ------------------------------------------------------------------ colour
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export const mix = (a, b, t) => { const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b); return hexOf(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t); };
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** Each look's shades, lightest → darkest: five per metal (hi … base … lo; owner: up to five per
 *  colour), the chess tones for the default. `light` = the rhombuses', `dark` = the band's. */
export const RAMPS = {
  default: { light: [CHESS.white, CHESS.cream, CHESS.ivory], dark: [CHESS.gray, CHESS.charcoal, CHESS.ebony] },
  ...Object.fromEntries(METALS.map((m) => {
    const r = [m.hi, mix(m.base, m.hi, 0.5), m.base, mix(m.base, m.lo, 0.5), m.lo];
    return [m.key, { light: r.slice(0, 3), dark: r.slice(2, 5) }];
  }))
};

// ------------------------------------------------------------------ the ring
export const RING_K = 0.65;                 // band thickness ÷ the avatar's radius (owner, 2026-09-26)
/** The ring's overall size for an avatar of `px`. */
export const ringBox = (px) => Math.ceil(px + 2 * ((px / 2) * RING_K + 1.5));
const f = (n) => n.toFixed(2);
// how much a direction faces the light (upper left): +1 facing it, −1 away
const facing = (x, y) => -(x + y) * Math.SQRT1_2;

/** The part of the ring (radii r0 < r1 round c) beyond the cut u > d, u = distance along the light
 *  axis toward the lower right. The cuts stay inside the hole's reach (|d| < r0), so each piece is
 *  two arcs joined by two straight edges — plain paths, no clip-path ids to collide on a page. */
function bandBeyond(c, r0, r1, d) {
  const n = [Math.SQRT1_2, Math.SQRT1_2], t = [Math.SQRT1_2, -Math.SQRT1_2];
  const at = (s) => [c + d * n[0] + s * t[0], c + d * n[1] + s * t[1]];
  const so = Math.sqrt(r1 * r1 - d * d), si = Math.sqrt(r0 * r0 - d * d);
  const [o1, o2, i1, i2] = [at(so), at(-so), at(si), at(-si)];
  const big = d < 0 ? 1 : 0;       // beyond a cut before the centre: the larger arcs
  return `M${f(o1[0])} ${f(o1[1])}A${r1} ${r1} 0 ${big} 1 ${f(o2[0])} ${f(o2[1])}L${f(i2[0])} ${f(i2[1])}A${r0} ${r0} 0 ${big} 0 ${f(i1[0])} ${f(i1[1])}Z`;
}

/** The ring SVG for an avatar of `px` pixels, in `look`. `remain` (0…1) makes the ring the turn clock
 *  (owner, 2026-09-26: no separate timer circle): only that share of the gems shows, counted clockwise
 *  from the top, the last one fading out — so they vanish one by one as the clock runs down. */
export function ringSvg(px, look = "default", remain = 1) {
  const { light, dark } = RAMPS[look] || RAMPS.default;
  const size = ringBox(px), c = size / 2, a = px / 2, w = a * RING_K, r0 = a + 0.5, r1 = r0 + w, rm = (r0 + r1) / 2;
  // the band's paint starts 1.5 px UNDER the avatar (which sits on top), so no hairline of the page
  // shows between them (owner: "a tiny seam"); the visible band and the gems keep r0…r1
  const rIn = a - 1.5;
  const ring = `M${f(c - r1)} ${f(c)}a${r1} ${r1} 0 1 0 ${f(2 * r1)} 0a${r1} ${r1} 0 1 0 ${f(-2 * r1)} 0ZM${f(c - rIn)} ${f(c)}a${rIn} ${rIn} 0 1 0 ${f(2 * rIn)} 0a${rIn} ${rIn} 0 1 0 ${f(-2 * rIn)} 0Z`;
  const cut = rm * 0.55;
  let s = `<path fill-rule="evenodd" d="${ring}" fill="${dark[0]}"/>`
    + `<path d="${bandBeyond(c, rIn, r1, -cut)}" fill="${dark[1]}"/><path d="${bandBeyond(c, rIn, r1, cut)}" fill="${dark[2]}"/>`;
  const len = w * 0.72, wid = Math.min(len * 0.95, w * 0.95);            // radial length, width along the band
  const n = Math.max(8, Math.floor((2 * Math.PI * rm) / (wid * 1.65)));
  const left = Math.max(0, Math.min(1, remain)) * n;          // how many gems are still showing
  for (let i = 0; i < n; i++) {
    const vis = Math.max(0, Math.min(1, left - i));
    if (vis <= 0) continue;
    const th = (i / n) * 2 * Math.PI - Math.PI / 2, ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
    const cx = c + rm * ux, cy = c + rm * uy;
    const o = [cx + (len / 2) * ux, cy + (len / 2) * uy], inn = [cx - (len / 2) * ux, cy - (len / 2) * uy];
    const A = [cx + (wid / 2) * vx, cy + (wid / 2) * vy], B = [cx - (wid / 2) * vx, cy - (wid / 2) * vy];
    const place = facing(ux, uy), tier = place > 0.35 ? 0 : place < -0.35 ? 2 : 1;
    const aLit = facing(vx, vy) > 0;                                    // the half facing the light
    const litTone = light[Math.max(0, tier - 1)], shadeTone = light[tier];
    const tone = (isA) => (isA === aLit ? litTone : shadeTone);
    const gem = `<polygon points="${f(o[0])},${f(o[1])} ${f(A[0])},${f(A[1])} ${f(inn[0])},${f(inn[1])}" fill="${tone(true)}"/>`
      + `<polygon points="${f(o[0])},${f(o[1])} ${f(B[0])},${f(B[1])} ${f(inn[0])},${f(inn[1])}" fill="${tone(false)}"/>`;
    s += vis < 1 ? `<g opacity="${vis.toFixed(2)}">${gem}</g>` : gem;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${s}</svg>`;
}

// ------------------------------------------------------------------ the badge (seat plate)
const steps = (a, b, c) => `linear-gradient(135deg, ${a} 0 34%, ${b} 34% 67%, ${c} 67% 100%)`;
/** The seat plate in `look`: its stepped background, the ink for the name and stack, and a softer
 *  ink for the status line. Tones stay close to the metal so the text stays legible. */
export function plateStyle(look = "default") {
  const m = METALS.find((x) => x.key === look);
  if (!m) return { bg: steps(CHESS.gray, CHESS.charcoal, CHESS.ebony), ink: CHESS.white, sub: CHESS.ivory, money: "#f5b60d" };
  const dark = lum(m.base) > 0.45;
  const ink = dark ? mix(m.lo, "#000000", 0.55) : "#ffffff";
  return {
    bg: steps(mix(m.base, m.hi, 0.28), m.base, mix(m.base, m.lo, 0.35)),
    ink, money: ink,
    sub: dark ? mix(m.lo, "#000000", 0.3) : mix(m.hi, "#ffffff", 0.4)
  };
}
