// Chip denomination palette — maps a chip amount to a casino-style colour set,
// so a bet/pot/flying chip reads its rough size at a glance (like real
// denominations). Tuned to sit on the app's dark-navy + gold system.

const TIERS = [
  { min: 0,      base: "#cdd2de", stripe: "#8b93a6", rim: "#aeb6c6", ink: "#1a2030" }, // silver/white
  { min: 50,     base: "#d64550", stripe: "#f4d3d6", rim: "#a8323b", ink: "#fff" },     // red
  { min: 200,    base: "#2f9e68", stripe: "#d9f0e3", rim: "#227a4f", ink: "#fff" },     // green
  { min: 1000,   base: "#2b3346", stripe: "#7f8aa3", rim: "#171d29", ink: "#fff" },     // charcoal
  { min: 5000,   base: "#8b5cf6", stripe: "#e7ddfc", rim: "#6b3fd0", ink: "#fff" },     // purple
  { min: 25000,  base: "#f4c94b", stripe: "#7a5a12", rim: "#c99a1e", ink: "#2a2206" },  // gold
];

// The colour set for a given chip amount (falls back to the smallest tier).
export function chipTier(value) {
  const v = Number(value) || 0;
  let t = TIERS[0];
  for (const tier of TIERS) if (v >= tier.min) t = tier;
  return t;
}

// A short display label for a chip face ("25", "1K", "5K", "25K", "1M").
export function chipLabel(value) {
  const v = Math.round(Number(value) || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v % 1_000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return String(v);
}
