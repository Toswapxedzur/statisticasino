// Currency = a ladder of minted METAL coins; the coin IS the bet. An amount maps
// to its nearest metal tier so a bet/pot/stack reads its rough size at a glance
// (a "metal skin" over the continuous economy — no fixed denominations). Warm
// cheap metals → bright precious → cool premium → dark exotic → a signature
// mythic apex (Riverstone). Tuned for the app's dark-navy + gold system.
//   base = mid metal · hi = highlight · lo = shadow · rim = milled edge · ink = engraving

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
