// River Sprint icon — three candidates, same rules and palette as icons.js (see package-info.md).
import { P, LIGHT, DARK, deg, f, shade, circle, ell, ringSeg, chip } from "./icons.js";
const { ebony, charcoal, gray, white, cream, ivory } = P;

/** A thick elliptical ring (a ripple), lit from the upper left. */
function ripple(cx, cy, rx, ry, w, tones) {
  const d = `M${f(cx - rx)} ${f(cy)}A${rx} ${ry} 0 1 0 ${f(cx + rx)} ${f(cy)}A${rx} ${ry} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
    + `M${f(cx - rx + w)} ${f(cy)}A${rx - w} ${ry - w * (ry / rx)} 0 1 1 ${f(cx + rx - w)} ${f(cy)}A${rx - w} ${ry - w * (ry / rx)} 0 1 1 ${f(cx - rx + w)} ${f(cy)}Z`;
  return shade(`<path fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`, cx, cy, rx * 0.6, tones);
}

// 1 · A chip skipping across the river: the water, the ripples where it bounced, drops, the chip in flight
function skipping() {
  let s = shade(`<ellipse cx="46" cy="69" rx="42" ry="15"/>`, 46, 69, 20, DARK, { gap: 0.6 });   // the water
  s += ripple(23, 69, 17, 6.4, 4.6, [cream, ivory]);                                               // the first bounce
  s += ripple(51, 66, 11, 4.2, 4, [white, cream]);                                                 // the second
  s += circle(46, 55, 2.9, [white, cream]) + circle(55, 52, 2.5, [white, cream]) + circle(60, 56, 2.1, [cream, ivory]);   // drops
  s += `<g transform="rotate(-22 68 27)">${chip(68, 27, 21, 8.4, 8.6, true)}</g>`;                   // the chip, rising
  return s;
}

/** A crescent moon: the disc (cx, cy, R) minus a disc (r) shifted by (dx, dy) — its horns open that way. */
function crescent(cx, cy, R, dx, dy, r, tones) {
  const d = Math.hypot(dx, dy), a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(R * R - a * a);
  const bx = cx + (a * dx) / d, by = cy + (a * dy) / d, nx = -dy / d, ny = dx / d;
  const [x1, y1, x2, y2] = [bx + h * nx, by + h * ny, bx - h * nx, by - h * ny];
  const shape = `<path d="M${f(x1)} ${f(y1)}A${R} ${R} 0 1 1 ${f(x2)} ${f(y2)}A${r} ${r} 0 0 0 ${f(x1)} ${f(y1)}Z"/>`;
  return shade(shape, cx - 1.5, cy + 1.5, R, tones, { k: 0.3 });
}

// 2 · A stopwatch with the river on its face (and a crescent moon over it)
function stopwatch() {
  let s = shade(`<rect x="41" y="8" width="14" height="9" rx="3"/>`, 48, 12, 8, [gray, charcoal])  // the top button
    + `<rect x="44.5" y="16" width="7" height="7" fill="${charcoal}"/>`
    + `<g transform="rotate(45 76 25)">${shade(`<rect x="71" y="20" width="10" height="9" rx="3"/>`, 76, 24, 7, [gray, charcoal])}</g>`;
  s += circle(48, 56, 35, LIGHT, { gap: 0.5 });                                                    // the case
  const face = `<circle cx="48" cy="56" r="27"/>`;
  s += shade(face, 48, 56, 27, [charcoal, ebony]);
  const id = "sw-face";
  // the waves' clip is a hair larger than the face, so no dark fringe of the face shows round them
  s += `<clipPath id="${id}"><circle cx="48" cy="56" r="27.8"/></clipPath><g clip-path="url(#${id})">`
    // the river: two bands touching — the lower one is drawn first and tucked 2 units under the
    // upper one, so no seam of the dark face can show between them
    // (lower and flatter than the first draft: the tide sits low, under a night sky)
    + `<path d="M10 77C22 72 32 72 46 77C60 82 70 82 86 77L86 92L10 92Z" fill="${ivory}"/>`
    + `<path d="M10 72C22 67 32 67 46 72C60 77 70 77 86 72L86 79C70 84 60 84 46 79C32 74 22 74 10 79Z" fill="${cream}"/></g>`;
  // the moon: horns 29° below the right, placed where its NEAREST gap to the rim, the tide, the hand and
  // the pivot is largest (6.4 units all round) — so it sits evenly in the open space left of the hand
  s += crescent(35.8, 51.3, 7.5, 3.88, 2.16, 6.4, [white, cream]);
  s += `<path d="M45 57L63 39L67 43L49 61Z" fill="${white}"/>`;                                    // the hand, towards the top right
  return s + circle(48, 58, 5.5, [white, cream]);
}

// 3 · A chip rolling on its edge along the river, speed marks behind it
function rolling() {
  let s = shade(`<path d="M4 78C18 71 30 71 44 78C58 85 72 85 92 78L92 88C72 95 58 95 44 88C30 81 18 81 4 88Z"/>`, 48, 82, 20, [gray, charcoal]);   // the river
  s += circle(62, 51, 26, [charcoal, ebony]);                                                       // the chip's edge (its thickness, behind)
  s += circle(57, 51, 26, LIGHT, { gap: 0.5 });                                                     // the face
  for (let i = 0; i < 6; i++) {                                                                     // edge spots on the face's rim
    const a0 = i * 60 - 12, a1 = a0 + 24, r0 = 19, r1 = 26;
    const p = (r, a) => [57 + r * Math.cos(deg(a)), 51 + r * Math.sin(deg(a))];
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    s += `<path d="M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z" fill="${Math.cos(deg(a0 + 12)) + Math.sin(deg(a0 + 12)) < 0 ? charcoal : ebony}"/>`;
  }
  s += circle(57, 51, 11, [cream, ivory]);                                                          // the inlay
  for (const [y, len] of [[35, 20], [51, 26], [67, 18]]) {                                          // speed marks, tapering back
    s += `<path d="M${29 - len} ${y - 2.2}L29 ${y - 4}Q31 ${y} 29 ${y + 4}L${29 - len} ${y + 2.2}Q${27 - len} ${y} ${29 - len} ${y - 2.2}Z" fill="${y === 51 ? cream : ivory}"/>`;
  }
  return s;
}

export const SPRINT = [["skipping", "1 · Skipping chip", skipping()], ["stopwatch", "2 · Stopwatch river", stopwatch()], ["rolling", "3 · Rolling chip", rolling()]];
