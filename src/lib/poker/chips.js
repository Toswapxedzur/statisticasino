// Currency = a ladder of minted METAL coins; the coin IS the bet. An amount maps
// to its nearest metal tier so a bet/pot/stack reads its rough size at a glance
// (a "metal skin" over the continuous economy — no fixed denominations).
// Ladder: metals → gems → exotic → mythic, full hue coverage, silver the only
// grey. Tuned for the app's dark-navy + gold system.
//   base = flat face colour · hi/lo = light/dark shades · rim = edge stroke ·
//   ink = engraving (kept for potential labels)

const TIERS = [
  { min: 0,       name: "copper",     base: "#c1691f", hi: "#eda45e", lo: "#71390c", rim: "#8f4c14", ink: "#2a1608" },
  { min: 5,       name: "brass",      base: "#d9a520", hi: "#f6d878", lo: "#805c0a", rim: "#a37a12", ink: "#2a2006" },
  { min: 25,      name: "silver",     base: "#c6cdda", hi: "#ffffff", lo: "#79808f", rim: "#9aa2b1", ink: "#242a3a" },
  { min: 100,     name: "gold",       base: "#f5b60d", hi: "#ffe485", lo: "#8f6503", rim: "#c78f06", ink: "#2a2206" },
  { min: 500,     name: "rose",       base: "#e8879b", hi: "#ffd3db", lo: "#8f3f50", rim: "#c05f72", ink: "#3a0f18" },
  { min: 2500,    name: "platinum",   base: "#9cc8ec", hi: "#e4f3ff", lo: "#4d7ba3", rim: "#6d9cc4", ink: "#12283a" },
  { min: 10000,   name: "ruby",       base: "#d63c48", hi: "#ff9aa1", lo: "#7c1a22", rim: "#a3242e", ink: "#fff" },
  { min: 50000,   name: "sapphire",   base: "#2f66d8", hi: "#8fb0f2", lo: "#16337e", rim: "#1f47a3", ink: "#fff" },
  { min: 250000,  name: "emerald",    base: "#17a35c", hi: "#7be7ab", lo: "#07512b", rim: "#0e7a42", ink: "#fff" },
  { min: 1000000, name: "obsidian",   base: "#3b2754", hi: "#7a5aa8", lo: "#180e26", rim: "#271739", ink: "#e6dcf6" },
  { min: 5000000, name: "riverstone", base: "#1fbfa4", hi: "#96f4e2", lo: "#0a5f50", rim: "#128a75", ink: "#04241e" },
];

// The metal tier for a given amount (falls back to the smallest tier).
export function chipTier(value) {
  const v = Number(value) || 0;
  let t = TIERS[0];
  for (const tier of TIERS) if (v >= tier.min) t = tier;
  return t;
}

// A short display label for a coin face ("25", "1K", "5K", "25K", "1M").
export function chipLabel(value) {
  const v = Math.round(Number(value) || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v % 1_000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return String(v);
}

// ---- the coin drawing (single source; Chip.svelte + string-HTML consumers) --
// A metal coin viewed AT AN ANGLE with depth (like a casino chip), FLAT colours
// (no gradients). Lighting = the face split into a lit region (top-left circle,
// hard edge) where every colour is a flat BRIGHTER version. Detail scales with
// render size, same model as the card deck: small = solid disc, medium =
// outer ring + inner circle, large = + small two-tone rhombus.
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const hexOf = (r, g, b) => "#" + ((1 << 24) | (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b)).toString(16).slice(1);
const parseHex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const darken = (h, f) => { const [r, g, b] = parseHex(h); return hexOf(r * (1 - f), g * (1 - f), b * (1 - f)); };
export const lighten = (h, f) => { const [r, g, b] = parseHex(h); return hexOf(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); };

const LIT = 0.30; // lit-region brightening
// The lit clip is identical for every coin; one shared id is fine (duplicate
// <defs> with the same content resolve to the first instance).
const LIT_CLIP = `<clipPath id="rv-coin-lit"><circle cx="-38" cy="-38" r="52" /></clipPath>`;

export function coinSvg(value, size = 20, { fillBox = false } = {}) {
  const t = chipTier(value);
  const form = size < 20 ? 1 : size < 34 ? 2 : 3;
  const outer = t.base, inner = darken(t.base, 0.22), edge = darken(t.base, 0.5);
  const tri1 = darken(t.base, 0.38), tri2 = darken(t.base, 0.58);
  const rh = (a, b) => `<polygon points="0,-16 -16,0 0,16" fill="${a}" /><polygon points="0,-16 16,0 0,16" fill="${b}" />`;
  const dims = fillBox ? `width="100%" height="100%"` : `width="${size}" height="${size}"`;
  return `<svg viewBox="0 0 100 100" ${dims} aria-hidden="true">
    <defs>${LIT_CLIP}</defs>
    <rect x="4" y="40" width="92" height="18" fill="${edge}" />
    <ellipse cx="50" cy="58" rx="46" ry="32" fill="${edge}" />
    <g transform="translate(50 40) scale(1 0.696)">
      <circle r="46" fill="${outer}" />
      ${form >= 2 ? `<circle r="31" fill="${inner}" />` : ""}
      ${form >= 3 ? rh(tri1, tri2) : ""}
      <g clip-path="url(#rv-coin-lit)">
        <circle r="46" fill="${lighten(outer, LIT)}" />
        ${form >= 2 ? `<circle r="31" fill="${lighten(inner, LIT)}" />` : ""}
        ${form >= 3 ? rh(lighten(tri1, LIT), lighten(tri2, LIT)) : ""}
      </g>
    </g>
  </svg>`;
}
