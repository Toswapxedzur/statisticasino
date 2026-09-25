// The dealer's deck in 3D — turning the whole 52-card stack over.
//
// Owner's spec (2026-09-25): side-over flip (about the deck's long axis, like a page),
// lifted and flipped in place, a random card face on the bottom, ~0.9 s, and smooth with
// the angular motion actually computed. The rest frame is the approved flat deck
// (composer.renderDeck): top card at its true shape, the stack's front edge below it.
//
// Model. 52 real thin rounded cards, 60×78 units, stacked T = 0.21 × 78 thick. World axes:
// x right, y down the card (screen down), z up off the table. The view is the same parallel
// projection as the flat deck — screen X = x, screen Y = y + (T − z) — so every flat face maps
// affinely and canvas draws it exactly. Cards are painted far-to-near along the view
// direction (0, 1, 1), so whatever faces the viewer is drawn last: the top card's back
// before 90°, the bottom card's face after, and in between the 52 card edges fanning out
// into the grey/white side face.
//
// Motion. θ(τ) follows the minimum-jerk curve (the standard model of a hand-driven move):
// angular speed and angular acceleration are both exactly zero at the start and the end, so
// there is no jolt anywhere. The lift is a smooth bump sized so the lowest corner of the
// rotating deck always clears the table, then settles back where it started.

export const W = 60, H = 78, R = 6;
export const COUNT = 52;
export const T = 0.21 * H;                  // stack thickness (owner: 0.3, then cards 30% thinner)
export const FLIP_MS = 900;
const t1 = T / COUNT;                       // one card
const CLEARANCE = 4;                        // gap under the lowest corner at mid-flip
// Highest point the centre must reach: the rotated half-extent peaks at √((W/2)²+(T/2)²).
export const LIFT_PEAK = Math.hypot(W / 2, T / 2) + CLEARANCE;

// Real-world deck for the physics readout: 52 × 1.8 g, 63.5 mm wide → 1 unit ≈ 1.058 mm.
const MM = 63.5 / W;
export const MASS_KG = 0.0936;
export const INERTIA = (MASS_KG * ((W * MM / 1000) ** 2 + (T * MM / 1000) ** 2)) / 12; // kg·m², about the long axis

// ---- motion ---------------------------------------------------------------------------
// s(τ) = 10τ³ − 15τ⁴ + 6τ⁵ : s(0)=0, s(1)=1, s'=s''=0 at both ends.
const s = (u) => u * u * u * (10 + u * (-15 + 6 * u));
const ds = (u) => 30 * u * u * (1 - u) * (1 - u);
const dds = (u) => 60 * u * (1 - u) * (1 - 2 * u);
// lift bump b(τ) = 64 τ³(1−τ)³ : 0 at both ends with zero velocity and acceleration, 1 at τ=½.
const bump = (u) => 64 * (u * (1 - u)) ** 3;
const dbump = (u) => 192 * (u * (1 - u)) ** 2 * (1 - 2 * u);

/** Half the rotated deck's height (centre → lowest corner) at angle θ. */
export function halfExtent(theta) {
  return (W / 2) * Math.abs(Math.sin(theta)) + (T / 2) * Math.abs(Math.cos(theta));
}

/**
 * Full kinematic state at normalised time u∈[0,1] of a flip from θ0 to θ0+π.
 * θ rad, ω rad/s, α rad/s², centre height (units), L kg·m²/s, torque N·m, vLift units/s.
 */
export function flipState(u, { theta0 = 0, dir = 1, durationMs = FLIP_MS } = {}) {
  const k = Math.min(1, Math.max(0, u));
  const D = durationMs / 1000;
  const theta = theta0 + dir * Math.PI * s(k);
  const omega = (dir * Math.PI * ds(k)) / D;
  const alpha = (dir * Math.PI * dds(k)) / (D * D);
  const lift = T / 2 + (LIFT_PEAK - T / 2) * bump(k);
  const vLift = ((LIFT_PEAK - T / 2) * dbump(k)) / D;
  return {
    u: k, theta, omega, alpha, lift, vLift,
    L: INERTIA * omega,
    torque: INERTIA * alpha,
    clearance: lift - halfExtent(theta)
  };
}

// ---- appearance ------------------------------------------------------------------------
// Same seeded sequence as composer.renderDeck (per card from the bottom: jitter, grey, white),
// so the rest frame reproduces the flat deck's strips.
function cardLook(n) {
  let seed = 0x5eed ^ n;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const look = new Array(n + 1);
  for (let k = n; k >= 1; k--) {
    const dx = Math.round((rnd() - 0.5) * 0.5 * 100) / 100;
    const grey = Math.round(160 + rnd() * 26), white = Math.round(236 + rnd() * 16);
    look[k] = { dx, grey, white };               // k = 1 is the top card
  }
  return look;
}
const LOOK = cardLook(COUNT);
const LIGHT = norm([-0.35, -0.45, 0.82]);         // from above, a little left and behind
function norm(v) { const l = Math.hypot(...v); return v.map((c) => c / l); }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// the card outline (rounded rect W×H, radius R) as a polygon in card space, 8 steps per corner
const OUTLINE = (() => {
  const pts = [], steps = 8;
  const corners = [[W - R, R, -90], [W - R, H - R, 0], [R, H - R, 90], [R, R, 180]];
  for (const [ccx, ccy, a0] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (90 * i) / steps) * Math.PI) / 180;
      pts.push([ccx + R * Math.cos(a), ccy + R * Math.sin(a)]);
    }
  return pts;
})();
// Andrew's monotone chain convex hull (points [x, y]); returns the hull in order
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Thickness of a stack of n cards. */
export const thickness = (n) => n * t1;
/** Card ids 1..52, top to bottom, of the deck as first built (id k keeps its own edge look). */
export const FULL_DECK = Array.from({ length: COUNT }, (_, i) => i + 1);

/**
 * A stack's shadow on the table: its footprint, softer and fainter the higher it is. Shadows are
 * cast on the TABLE, so they must all be drawn before any card (see drawScene) — drawn with each
 * stack, a lifted packet's shadow was painted over the cards beneath it.
 */
export function drawStackShadow(ctx, { ids, theta = 0, fx, fy, baseZ = 0, rise = 0, scale = 1 }) {
  const n = ids.length;
  if (!n) return;
  const Tn = n * t1;
  const c = Math.cos(theta), sn = Math.sin(theta);
  const cz = baseZ + Tn / 2 + rise;
  const low = cz - ((W / 2) * Math.abs(sn) + (Tn / 2) * Math.abs(c));
  const hAbove = Math.max(0, low);
  const halfW = (W / 2) * Math.abs(c) + (Tn / 2) * Math.abs(sn);
  ctx.save();
  if (scale !== 1) { ctx.translate(fx, fy); ctx.scale(scale, scale); ctx.translate(-fx, -fy); }
  // canvas blur is in device pixels: scale it with the units→px transform
  ctx.filter = `blur(${((1.5 + hAbove * 0.35) * ctx.getTransform().a).toFixed(2)}px)`;
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.1, (0.34 - hAbove * 0.006) * Math.min(1, 0.45 + n / 40)).toFixed(3)})`;
  ctx.beginPath();
  ctx.roundRect(fx - halfW, fy - H / 2 + 1, halfW * 2, H, R);
  ctx.fill();
  ctx.restore();
}

/** Draw a set of stacks: every shadow onto the table first, then the cards far → near. */
export function drawScene(ctx, stacks, art) {
  for (const st of stacks) drawStackShadow(ctx, st);
  for (const st of stacks) drawStack(ctx, st, art);
}

/**
 * Draw one stack of cards. ctx is a 2D context already scaled so 1 unit = some CSS px.
 *   ids    card ids (1..52) top → bottom in the stack's own frame; each keeps its strip look
 *   theta  rotation about the stack's long axis (0 = as dealt, π = turned over)
 *   fx,fy  the stack's footprint centre on the table (screen units)
 *   baseZ  height of the stack's underside above the table at rest (e.g. lying on a pile)
 *   rise   extra lift of the centre (the flip's lift above resting)
 *   scale  size about the footprint centre (> 1 = closer to the viewer)
 * art: { back, face } images W×H; face = the card showing when the stack is turned over.
 */
export function drawStack(ctx, { ids, theta = 0, fx, fy, baseZ = 0, rise = 0, scale = 1 }, art) {
  const n = ids.length;
  if (!n) return;
  const Tn = n * t1;
  ctx.save();
  if (scale !== 1) { ctx.translate(fx, fy); ctx.scale(scale, scale); ctx.translate(-fx, -fy); }
  // Right edge lifts first (the side face appears on the right, as the owner's preview showed):
  // local x → (cosθ, 0, sinθ), local normal (up) → (−sinθ, 0, cosθ).
  const c = Math.cos(theta), sn = Math.sin(theta);
  const ex = [c, 0, sn], ez = [-sn, 0, c];
  const cx = fx, cyW = fy - T, cz = baseZ + Tn / 2 + rise;   // screen Y = y + (T − z)

  // screen transform for a card plane at stack offset s (along ez from the stack centre)
  const plane = (sOff, dx = 0) => {
    const ox = cx + (dx - W / 2) * ex[0] + sOff * ez[0];
    const oz = cz + (dx - W / 2) * ex[2] + sOff * ez[2];
    return [ex[0], -ex[2], 0, 1, ox, cyW - H / 2 + T - oz];
  };

  const base = ctx.getTransform();
  const facingUp = ez[2] >= 0;                     // top card's back faces the viewer
  // rim brightness: neutral at rest (only the front edge shows); as the side rim turns
  // toward the viewer it takes up to 14% shade, less where it faces the light
  const rim = sn >= 0 ? ex : ex.map((v) => -v);
  const rimLight = 1 - 0.14 * Math.abs(sn) * (1 - Math.max(0, dot(rim, LIGHT)));

  // Every card is a real slab with thickness, not a zero-thickness plane: edge-on (θ = 90°) a
  // plane has no area and the side face would vanish. Each layer of a card (its grey gap, then
  // its white edge) is drawn as the convex hull of its lower and upper outlines — exact for a
  // parallel projection — so edge-on it is a strip one layer thick, and the strips form the
  // side face at every angle.
  const hull2 = (dx, sA, sB) => {
    const pts = [];
    for (const sOff of [sA, sB]) {
      const [a, b, , d, e, f0] = plane(sOff, dx);
      for (const [u, v] of OUTLINE) pts.push([a * u + e, b * u + d * v + f0]);
    }
    return convexHull(pts);
  };
  // far → near: bottom card first when the top faces up, reversed once turned over
  const order = [];
  for (let j = n; j >= 1; j--) order.push(j);
  if (!facingUp) order.reverse();
  ctx.setTransform(base);
  for (const j of order) {
    const L = LOOK[ids[j - 1]];
    const sLow = Tn / 2 - j * t1;                  // the card's lower side
    const sMid = sLow + 0.4 * t1;                  // grey gap below, white edge above
    const sTop = sLow + t1;
    const zCard = cz + sLow * ez[2];
    const occ = 1 - 0.2 * Math.min(1, Math.max(0, 1 - zCard / T)); // darker near the table
    const f = occ * rimLight;
    const grey = [sLow, sMid, L.grey, 4], white = [sMid, sTop, L.white, -3];
    for (const [sA, sB, g, blue] of facingUp ? [grey, white] : [white, grey]) {
      const poly = hull2(L.dx, sA, sB);
      ctx.fillStyle = `rgb(${Math.round(g * f)},${Math.round(g * f)},${Math.round((g + blue) * f)})`;
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
  }

  // the cap that faces the viewer: the top card's back, or the bottom card's face
  // relative to how the cap is lit at rest, so the rest frame is exactly the flat deck
  const capLight = (0.78 + 0.22 * Math.max(0, facingUp ? dot(ez, LIGHT) : -dot(ez, LIGHT))) / (0.78 + 0.22 * LIGHT[2]);
  if (facingUp) {
    ctx.setTransform(base.multiply(new DOMMatrix(plane(Tn / 2))));
    if (art.back) ctx.drawImage(art.back, 0, 0, W, H);
  } else {
    // seen from below, the face would read mirrored — flip it back in card space
    ctx.setTransform(base.multiply(new DOMMatrix(plane(-Tn / 2))).multiply(new DOMMatrix([-1, 0, 0, 1, W, 0])));
    if (art.face) ctx.drawImage(art.face, 0, 0, W, H);
  }
  if (capLight < 1) {
    ctx.fillStyle = `rgba(0,0,0,${((1 - capLight) * 0.6).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The whole 52-card deck (the flip demo). state: { theta, lift } from flipState (lift = centre
 * height; resting = T/2). origin: screen position (units) of the flat deck's top-left at rest.
 */
export function drawDeck(ctx, { theta, lift }, art, origin = { x: 0, y: 0 }) {
  drawScene(ctx, [{ ids: FULL_DECK, theta, fx: origin.x + W / 2, fy: origin.y + T + H / 2, rise: lift - T / 2 }], art);
}

/**
 * Room the flip needs around the resting deck, in units, measured from the motion itself:
 * above = how far the highest corner rises above the resting top edge; side = how far a
 * corner swings past the resting left/right edge. Pad for the shadow blur.
 */
export const STAGE = (() => {
  let above = 0, side = 0;
  for (let i = 0; i <= 400; i++) {
    const st = flipState(i / 400);
    above = Math.max(above, st.lift + halfExtent(st.theta) - T);
    side = Math.max(side, (W / 2) * Math.abs(Math.cos(st.theta)) + (T / 2) * Math.abs(Math.sin(st.theta)) - W / 2);
  }
  const pad = 8;
  return { above: above + pad, side: side + pad, below: pad, w: W + 2 * (side + pad), h: H + T + above + 2 * pad };
})();
