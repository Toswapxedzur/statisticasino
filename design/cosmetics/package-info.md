# design/cosmetics — avatar rings and seat-plate badges

- `sheet.mjs` → `sheet.html` / `sheet.png` — every look drawn from the game's own module
  (`src/lib/cosmetics.js`): rings large, the seat plate at table size, your own seat.
- Owner's spec (2026-09-26): ring = a band 65% of the avatar's radius with rhombuses FLOATING in it
  (each two triangles, as on the coin), rhombuses always lighter than the band, up to five shades per
  metal, lit from the upper left in hard steps; badge = the seat plate in three stepped tones. Default
  = the six chess tones; metals unlock at peak wealth Gold 25K · Ruby 100K · Sapphire 250K · Emerald 1M
  · Obsidian 5M · Riverstone 25M (permanent). Managed on /cosmetics.
