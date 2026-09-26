// Game icons — owner's rules (2026-09-26): only the six warm tones below, NO borders, NO thin lines,
// NO letters or numbers, NO card elements; every part a solid shape. Light comes from the UPPER LEFT:
// each shape is cut across its middle into stepped tones (hard edges, no smooth gradients) — two
// tones for small parts, three for big blocks — always within ONE family (light: white › cream ›
// ivory; dark: gray › charcoal › ebony). Drawn on a 96×96 grid.
export const P = { ebony: "#1C1A15", charcoal: "#3E3A31", gray: "#6E685B", white: "#FBF8EF", cream: "#F1E9D3", ivory: "#E1D3AD" };
const { ebony, charcoal, gray, white, cream, ivory } = P;
const LIGHT = [white, cream, ivory], DARK = [gray, charcoal, ebony];
const deg = (a) => (a * Math.PI) / 180;
const f = (n) => Math.round(n * 100) / 100;
let uid = 0;

/** A shape (markup without fill) in stepped tones along the light: tones[0] on the lit upper-left,
 *  the last on the lower-right. (cx, cy) the cut's centre, r the shape's half-size. k shifts the cut
 *  (−1 … 1, positive = more light), gap the width of the middle band for three tones. */
function shade(shape, cx, cy, r, tones, { k = 0, gap = 0.5 } = {}) {
  const id = `c${++uid}`, L = r * 4;
  const half = (off, fill) => {   // the half-plane (x−cx)+(y−cy) > off, beyond the cut
    const mx = cx + off / 2, my = cy + off / 2;
    return `<polygon points="${f(mx + L)},${f(my - L)} ${f(mx + L)},${f(my + L)} ${f(mx - L)},${f(my + L)}" fill="${fill}"/>`;
  };
  const c = k * r;
  let s = `<clipPath id="${id}">${shape}</clipPath><g clip-path="url(#${id})"><rect x="${f(cx - L)}" y="${f(cy - L)}" width="${f(2 * L)}" height="${f(2 * L)}" fill="${tones[0]}"/>`;
  if (tones.length === 2) s += half(c, tones[1]);
  else s += half(c - gap * r, tones[1]) + half(c + gap * r, tones[2]);
  return s + "</g>";
}
const circle = (cx, cy, r, tones, o) => shade(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}"/>`, cx, cy, r, tones, o);
const ell = (cx, cy, rx, ry, t) => [cx + rx * Math.cos(deg(t)), cy + ry * Math.sin(deg(t))];
/** The part of an elliptical ring between scale s0 and 1, from angle a to b (a top-face rim spot). */
function ringSeg(cx, cy, rx, ry, s0, a, b) {
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push(ell(cx, cy, rx, ry, a + ((b - a) * i) / 6));
  for (let i = 6; i >= 0; i--) pts.push(ell(cx, cy, rx * s0, ry * s0, a + ((b - a) * i) / 6));
  return `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}"/>`;
}

// ---------------------------------------------------------------- Hold'em: stacks of real chips
// A chip is a short cylinder: the front of its side band, the top face, and six edge spots that
// wrap from the side over the rim. Lit from the left, so the side steps lighter → darker.
function chip(cx, cy, rx = 18, ry = 6.6, h = 7.6, top = true) {
  let s = "";
  const side = `<path d="M${f(cx - rx)} ${f(cy)}L${f(cx - rx)} ${f(cy + h)}A${rx} ${ry} 0 0 0 ${f(cx + rx)} ${f(cy + h)}L${f(cx + rx)} ${f(cy)}A${rx} ${ry} 0 0 1 ${f(cx - rx)} ${f(cy)}Z"/>`;
  const id = `c${++uid}`;
  s += `<clipPath id="${id}">${side}</clipPath><g clip-path="url(#${id})"><rect x="${f(cx - rx)}" y="${f(cy - ry)}" width="${f(rx * 2)}" height="${f(ry * 2 + h + 2)}" fill="${cream}"/><rect x="${f(cx + rx * 0.3)}" y="${f(cy - ry)}" width="${f(rx)}" height="${f(ry * 2 + h + 2)}" fill="${ivory}"/></g>`;
  for (const t of [30, 90, 150]) {             // side spots: narrower toward the edges, as they turn away
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(ell(cx, cy, rx, ry, t - 13 + (26 * i) / 6));
    const bottom = pts.map(([x, y]) => [x, y + h]).reverse();
    s += `<polygon points="${[...pts, ...bottom].map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${t === 30 ? ebony : charcoal}"/>`;
  }
  if (!top) return s;
  s += shade(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}"/>`, cx, cy, rx * 0.55, [white, cream], { k: 0.9 });
  for (const t of [30, 90, 150, 210, 270, 330]) s += ringSeg(cx, cy, rx, ry, 0.72, t - 13, t + 13).replace("/>", ` fill="${t === 210 || t === 270 ? gray : charcoal}"/>`);
  s += shade(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx * 0.5)}" ry="${f(ry * 0.5)}"/>`, cx, cy, rx * 0.3, [cream, ivory]);
  return s;
}
// Three piles of two chips in a triangle (two behind, one in front — so none hides another), and a
// fourth pile of two resting on top of them, centred over the three. No offsets: every pile stands straight.
function pile(cx, ground, n, rx, ry, h) {        // ground = the y of the bottom chip's bottom face centre
  let s = "";
  for (let i = 0; i < n; i++) s += chip(cx, ground - h * (i + 1), rx, ry, h, i === n - 1);
  return s;
}
// The group turned `turn` degrees about its vertical axis (a turntable): the three piles sit on a
// circle round the centre in the table plane, projected with the chips' own tilt (ry / rx); drawn
// back to front.
function holdem(turn = 30, n = 3) {
  const rx = 20, ry = 9.6, h = 7.6, tilt = ry / rx, R = (2 * rx) / Math.sqrt(3);
  const spots = [90, 210, 330].map((a) => [R * Math.cos(deg(a + turn)), R * Math.sin(deg(a + turn))]);
  const xs = spots.map(([x]) => x), zs = spots.map(([, z]) => z);
  // centre the whole group: from the top pile's top face to the front pile's bottom edge
  const top = -2 * n * h - ry, bottom = Math.max(...zs) * tilt + ry;
  const ox = 48 - (Math.min(...xs) + Math.max(...xs)) / 2, oz = 48 - (top + bottom) / 2;
  let s = "";
  for (const [x, z] of spots.sort((a, b) => a[1] - b[1])) s += pile(ox + x, oz + z * tilt, n, rx, ry, h);
  return s + pile(ox, oz - n * h, n, rx, ry, h);
}

// ---------------------------------------------------------------- Blackjack: the half-moon table
// Seen at an angle: the padded rail round the curve, the table's edge below it, and the player spots
// on the felt. (No chip rack: owner, 2026-09-26.)
function blackjack() {
  const cy = 27.75, drop = 10.5;        // the edge: 1.5× the first draft (owner, 2026-09-26); cy centres the table
  let s = shade(`<path d="M6 ${cy}L6 ${cy + drop}A42 30 0 0 0 90 ${cy + drop}L90 ${cy}Z"/>`, 48, cy + 20, 30, DARK, { gap: 0.6 });   // the edge: the only dark drop, three tones
  s += shade(`<path d="M6 ${cy}A42 30 0 0 0 90 ${cy}Z"/>`, 48, cy + 12, 30, LIGHT, { gap: 0.6 });                                       // the padded rail
  s += shade(`<path d="M15 ${cy}A33 22 0 0 0 81 ${cy}Z"/>`, 48, cy + 8, 22, [gray, charcoal], { k: -0.2 });                             // the felt
  for (const t of [28, 62, 90, 118, 152]) { const [x, y] = ell(48, cy, 23, 14, t); s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="5.2" ry="3.6" fill="${x > 52 ? ivory : cream}"/>`; }
  return s;
}

// ---------------------------------------------------------------- Baccarat: the Big Road scoreboard
// A wide scoreboard grid: banker (dark) and player (gray) wins fill the columns in streaks; the empty
// places of the grid show as small marks, so it reads as a board, not as a die.
function baccarat() {
  let s = shade(`<rect x="5" y="19" width="86" height="58" rx="9"/>`, 48, 48, 30, LIGHT, { gap: 0.6 });
  const streaks = [[1, 1, 1], [0, 0], [1], [0, 0, 0, 0], [1, 1], [0]];
  for (let c = 0; c < 6; c++) for (let r = 0; r < 4; r++) {
    const x = 17 + c * 12.4, y = 29 + r * 12.7, v = streaks[c][r];
    if (v === undefined) s += `<circle cx="${f(x)}" cy="${f(y)}" r="2.2" fill="${ivory}"/>`;
    else s += circle(x, y, 4.9, v ? [charcoal, ebony] : [gray, charcoal]);
  }
  return s;
}

// ---------------------------------------------------------------- Three Card Poker: the three spots
function threeCard() {
  return shade(`<path d="M48 7L67 30L48 53L29 30Z"/>`, 48, 30, 20, LIGHT, { gap: 0.55 })
    + shade(`<path d="M48 21L57 30L48 39L39 30Z"/>`, 48, 30, 9, [charcoal, ebony])
    + circle(27, 67, 19, LIGHT) + circle(27, 67, 8, [charcoal, ebony])
    + circle(69, 67, 19, LIGHT) + circle(69, 67, 8, [charcoal, ebony]);
}

// ---------------------------------------------------------------- Roulette: the wheel
// The rim (convex, lit upper-left), the pockets (each lit or shaded by where it sits), the bowl
// (concave, so its LOWER-RIGHT wall catches the light), the cone and the ball.
function wedge(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(deg(a)), cy + r * Math.sin(deg(a))];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}
function roulette() {
  let s = circle(48, 48, 44, [white, cream]);                   // the rim: the 1st and 2nd whites
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = (360 / n) * i - 90, a1 = a0 + 360 / n, mid = deg((a0 + a1) / 2);
    const lit = Math.cos(mid) + Math.sin(mid) < 0;
    const fill = i === 0 ? gray : i % 2 ? (lit ? charcoal : ebony) : (lit ? white : ivory);
    s += `<path d="${wedge(48, 48, 27, 38, a0, a1)}" fill="${fill}"/>`;
  }
  s += circle(48, 48, 27, [ivory, cream]);                       // the bowl: the 2nd and 3rd whites; concave, so lit lower-right
  s += circle(48, 48, 15, [white, ivory]);                       // the cone
  for (const a of [45, 135, 225, 315]) {                         // the turret's cross
    const x = 48 + 13 * Math.cos(deg(a)), y = 48 + 13 * Math.sin(deg(a));
    s += `<line x1="48" y1="48" x2="${f(x)}" y2="${f(y)}" stroke="${a === 45 ? ebony : charcoal}" stroke-width="6" stroke-linecap="round"/>`;
  }                                                              // (no hub: the cross is just its two bars)
  const [bx, by] = [48 + 32.5 * Math.cos(deg(-80)), 48 + 32.5 * Math.sin(deg(-80))];
  return s + circle(bx, by, 4.8, [white, cream]);
}

// ---------------------------------------------------------------- Sic Bo: three dice
function die(cx, cy, rot, face) {
  const pips = { 3: [[-1, -1], [0, 0], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[face];
  let s = shade(`<rect x="${cx - 17}" y="${cy - 17}" width="34" height="34" rx="8" transform="rotate(${rot} ${cx} ${cy})"/>`, cx, cy, 17, LIGHT, { gap: 0.5 });
  s += `<g transform="rotate(${rot} ${cx} ${cy})">`;
  for (const [a, b] of pips) s += `<circle cx="${cx + a * 9}" cy="${cy + b * 9}" r="3.7" fill="${ebony}"/>`;
  return s + "</g>";
}
const sicbo = () => die(48, 25, 8, 6) + die(26, 66, -10, 5) + die(70, 67, 12, 3);

// ---------------------------------------------------------------- Slots: cherries
function slots() {
  return shade(`<path d="M52 12C58 12 70 14 76 20C68 24 58 22 52 12Z"/>`, 64, 17, 10, [gray, charcoal])
    + `<path d="M50 11C44 26 34 42 29 55L35 57C39 45 47 30 55 13Z" fill="${charcoal}"/>`
    + `<path d="M52 13C58 28 64 46 66 60L60 61C58 48 53 32 48 15Z" fill="${ebony}"/>`
    + circle(31, 67, 18, LIGHT, { gap: 0.5 }) + circle(65, 71, 17, LIGHT, { gap: 0.5 });
}

// ---------------------------------------------------------------- Big Two: a crown on two steps
// The steps show their tops (lit) and fronts (shaded); the crown stands right on the upper step.
function bigTwo() {
  // each step is one block with rounded corners: its lit top strip and its shaded front
  const step = (x, y, w, top, front, k) => {
    const id = `c${++uid}`;
    return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${top + front}" rx="4"/></clipPath><g clip-path="url(#${id})">`
      + `<rect x="${x}" y="${y}" width="${w}" height="${top}" fill="${gray}"/>`
      + shade(`<rect x="${x}" y="${y + top}" width="${w}" height="${front}"/>`, x + w / 2, y + top + front / 2, front, [charcoal, ebony], { k }) + `</g>`;
  };
  return step(8, 72, 80, 5, 12, -1.2) + step(20, 57, 56, 5, 10, 1.6)
    + shade(`<path d="M24 57L20 25L36 38L48 16L60 38L76 25L72 57Z"/>`, 48, 40, 26, LIGHT, { gap: 0.5 })
    + shade(`<rect x="24" y="48" width="48" height="9"/>`, 48, 52.5, 10, [cream, ivory])
    + circle(20, 24, 4.8, [white, cream]) + circle(48, 15, 5.4, [white, cream]) + circle(76, 24, 4.8, [white, cream])
    + circle(36, 43, 3.6, [charcoal, ebony]) + circle(48, 41, 4.2, [charcoal, ebony]) + circle(60, 43, 3.6, [charcoal, ebony]);
}

export const ICONS = [
  ["holdem", "Hold'em", "stacks of poker chips", holdem],
  ["blackjack", "Blackjack", "the half-moon table: rail, felt, player spots", blackjack],
  ["baccarat", "Baccarat", "the Big Road scoreboard", baccarat],
  ["three-card", "Three Card Poker", "the three betting spots", threeCard],
  ["roulette", "Roulette", "the wheel and ball", roulette],
  ["sic-bo", "Sic Bo", "three dice", sicbo],
  ["slots", "Slots", "cherries", slots],
  ["big-two", "Big Two", "a crown on two steps", bigTwo]
].map(([k, n, d, fn]) => [k, n, d, fn()]);
export const svg = (body, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}">${body}</svg>`;
