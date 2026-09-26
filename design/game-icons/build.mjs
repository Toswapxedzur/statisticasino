// The game icons (icons.js) → static/games/<key>.svg, one self-contained file each (its own
// clip-path ids, so any number can sit on one page). Run from statisticasino/:
//   node design/game-icons/build.mjs
import { ICONS, svg } from "./icons.js";
import { SPRINT } from "./sprint.js";
import { writeFileSync, mkdirSync } from "node:fs";
const out = new URL("../../static/games/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const [key, , , body] of ICONS) writeFileSync(new URL(`${key}.svg`, out), svg(body, 96).replace(/ width="96" height="96"/, "") + "\n");
// the River Sprint event: the owner's stopwatch (sprint.js)
const stopwatch = SPRINT.find(([k]) => k === "stopwatch")[2];
writeFileSync(new URL("river-sprint.svg", out), svg(stopwatch, 96).replace(/ width="96" height="96"/, "") + "\n");
console.log(`wrote ${ICONS.length} game icons + river-sprint.svg to static/games/`);
