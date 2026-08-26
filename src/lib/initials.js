// Shared avatar helpers: a TWO-letter monogram fallback + a stable color.
// "John Smith" -> "JS", "Wholeseller" -> "WH", "Tester A" -> "TA".
export function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export const AV_COLORS = ["#c0674f", "#4f7bc0", "#59a06a", "#8a5fb0", "#b0824f", "#4fa3b0", "#c05f8a", "#6a8f3a"];
export function avColor(id) {
  let h = 0;
  for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
