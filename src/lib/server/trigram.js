// Trigram helpers for typo-tolerant real-time friend search. A name is
// normalized to [a-z0-9] and split into overlapping 3-grams; two names' overlap
// (count of shared grams) is a fuzzy similarity score. Grams live in the
// `user_trigram` table so ranking is a single indexed GROUP BY.
import * as realDb from "./db.js";

export function trigrams(name) {
  const norm = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return [];
  if (norm.length < 3) return [norm.padEnd(3, norm[0] || "_")];
  const set = new Set();
  for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
  return [...set];
}

// Replace a user's stored grams with the current name's. Best-effort.
export async function syncTrigrams(userId, name, db = realDb) {
  if (!userId) return;
  const grams = trigrams(name);
  await db.execute("DELETE FROM user_trigram WHERE user_id = ?", [userId]);
  if (!grams.length) return;
  const values = grams.map(() => "(?, ?)").join(", ");
  const params = [];
  for (const g of grams) params.push(userId, g);
  await db.execute(`INSERT IGNORE INTO user_trigram (user_id, gram) VALUES ${values}`, params);
}
