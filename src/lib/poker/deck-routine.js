// The dealer's opening routine, as a pure timeline: frameAt(t) says where every card is.
//
// Owner's spec (2026-09-25). In the real game the face-down deck lives top-left, just below the
// top bar, and the face-up (used) pile lives top-right at the same height. The routine:
//   1. the face-up pile flies from the top-right to the table centre while turning over (the
//      side-over flip) and growing ~1.6× ("closer to the user");
//   2. three MIDDLE-SECTION CUTS, a different random middle section each time: the middle section
//      is pulled out horizontally, makes a flat U-turn whose far point is 1.5 card-widths from the
//      deck (a 50% gap), and comes back horizontally onto the top — straight segments so packets
//      never pass through each other. The top section falls onto the bottom section and lands at
//      the exact moment the middle section's left edge touches the combined deck's right edge;
//   3. the deck splits into two piles; cards leave the tops of the two piles one by one to a
//      third pile — the shuffle — the three piles forming a triangle;
//   4. the third pile (the whole deck) flies to the top-left and returns to its original size.
//
// Every move is minimum-jerk (zero speed and acceleration at both ends), like the flip. Each
// physical card keeps its id — and so its own edge strip — wherever it goes; the tests check that
// every frame holds each of the 52 cards exactly once, that nothing ever jumps or collides, and
// the landing/edge-touch timing.

import { W, H, COUNT, FLIP_MS, FULL_DECK, flipState, thickness } from "./deck3d.js";

const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
const arc = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; }; // 0→1→0, smooth ends
const lerp = (a, b, k) => a + (b - a) * k;
// the time fraction at which mj reaches a given progress (mj is monotonic)
function mjInverse(p) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (mj(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const ZOOM = 1.6;
export const TIMING = {
  flyIn: FLIP_MS,        // top-right → centre, turning over, growing
  settle: 150,
  cutPass: 760,          // one middle-section cut: out, U-turn, back on top
  cutGap: 100,           // breath between passes
  cuts: 3,
  beforeSplit: 100,
  split: 500,
  beforeShuffle: 100,
  launchEvery: 45,       // a card leaves a pile every 45 ms …
  flight: 320,           // … and takes 320 ms to land on the third pile
  beforeReturn: 150,
  flyBack: 800
};
export const UTURN = 1.5;  // the U-turn's far point, in card widths from the deck (a 50% gap)

/**
 * The middle section's path for one cut, in (x offset from the deck centre, z height):
 * straight out at its own level to the deck's edge, a flat half-ellipse U-turn out to UTURN card
 * widths, straight back in at the top level. Returns the path sampled by screen arc length, plus
 * the progress points where the middle clears the deck and where its edge touches again.
 */
function middlePath(Wz, zMid, zFin, zoom) {
  const L1 = Wz, L3 = Wz;
  const rx = (UTURN - 1) * Wz, rz = (zFin - zMid) / 2, zc = (zMid + zFin) / 2;
  // half-ellipse, arc length by sampling in screen units (z shows 1:1 at the zoom)
  const N = 200, pts = [], cum = [0];
  for (let i = 0; i <= N; i++) {
    const phi = (Math.PI * i) / N;
    pts.push({ x: Wz + rx * Math.sin(phi), z: zc - rz * Math.cos(phi) });
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].z - pts[i - 1].z) * zoom));
  }
  const L2 = cum[N], L = L1 + L2 + L3;
  function at(p) {                           // p = 0..1 progress along the whole path
    const s = p * L;
    if (s <= L1) return { x: s, z: zMid };
    if (s >= L1 + L2) return { x: Wz - (s - L1 - L2), z: zFin };
    const d = s - L1;
    let i = 1;
    while (i < N && cum[i] < d) i++;
    const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: lerp(pts[i - 1].x, pts[i].x, k), z: lerp(pts[i - 1].z, pts[i].z, k) };
  }
  return { at, clear: L1 / L, touch: (L1 + L2) / L };
}

/**
 * Build the routine. start = the face-up pile's spot (top-right), end = the deck's spot
 * (top-left), centre = where the shuffle happens; all footprint centres in table units (a card
 * is 60 wide at normal size). Returns { duration, phases, frameAt(t), finalOrder, layout, cuts }.
 */
export function buildRoutine({ start, end, centre, seed = 1, zoom = ZOOM, timing = TIMING } = {}) {
  end = end || start;
  const r = rng(seed);
  const Tm = timing;
  const Wz = W * zoom;
  // the triangle: piles never touch — the base piles sit a card-width-plus apart from the apex
  // horizontally, and a full card height below it
  const pileA = { fx: centre.fx - Wz * 1.15, fy: centre.fy + zoom * H * 0.45 };
  const pileB = { fx: centre.fx + Wz * 1.15, fy: centre.fy + zoom * H * 0.45 };
  const pileC = { fx: centre.fx, fy: centre.fy - zoom * H * 0.55 };   // the apex, toward the deck spots

  // ---- plan the cards (deterministic for a seed) ----
  let order = FULL_DECK.slice();                          // top → bottom, face-down frame
  const cuts = [];
  for (let i = 0; i < Tm.cuts; i++) {
    // a different random middle section each pass: top 20–40%, middle 25–40%, bottom the rest (≥ 20%)
    const a = Math.round(COUNT * (0.2 + 0.2 * r()));
    const m = Math.min(COUNT - a - Math.round(COUNT * 0.2), Math.round(COUNT * (0.25 + 0.15 * r())));
    const top = order.slice(0, a), middle = order.slice(a, a + m), bottom = order.slice(a + m);
    const zMid = thickness(bottom.length), zFin = thickness(top.length + bottom.length);
    const path = middlePath(Wz, zMid, zFin, zoom);
    cuts.push({ top, middle, bottom, zMid, zFin, path, tClear: mjInverse(path.clear), tTouch: mjInverse(path.touch) });
    order = middle.concat(top, bottom);                  // the middle section ends on top
  }
  const half = Math.round(COUNT / 2);
  const splitA = order.slice(0, half), splitB = order.slice(half);   // top half left, bottom half right
  // the shuffle: alternating runs of 1–3 cards from the tops of the two piles
  const qa = splitA.slice(), qb = splitB.slice(), launches = [];
  let side = r() < 0.5 ? "A" : "B";
  while (qa.length || qb.length) {
    const src = side === "A" ? qa : qb;
    const run = Math.min(src.length, [1, 1, 2, 2, 3][Math.floor(r() * 5)]);
    for (let i = 0; i < run; i++) launches.push({ id: src.shift(), from: side });
    side = side === "A" ? (qb.length ? "B" : "A") : (qa.length ? "A" : "B");
  }
  const finalOrder = launches.map((l) => l.id).reverse();   // last to land is on top

  // ---- phase boundaries ----
  const phases = [];
  let t = 0;
  const add = (name, dur) => { phases.push({ name, t0: t, t1: t + dur }); t += dur; };
  add("fly-in", Tm.flyIn);
  add("settle", Tm.settle);
  for (let i = 0; i < Tm.cuts; i++) { add(`cut ${i + 1}`, Tm.cutPass); if (i < Tm.cuts - 1) add("pause", Tm.cutGap); }
  add("pause", Tm.beforeSplit);
  add("split", Tm.split);
  add("pause", Tm.beforeShuffle);
  add("shuffle", (launches.length - 1) * Tm.launchEvery + Tm.flight);
  add("pause", Tm.beforeReturn);
  add("fly-back", Tm.flyBack);
  const duration = t;
  const P = (name) => phases.find((p) => p.name === name);
  const cutPhases = phases.filter((p) => p.name.startsWith("cut "));

  /** Top-section height during a cut at progress k: holds until the middle clears, then falls
   *  from rest (accelerating, like a drop) and lands exactly when the middle's edge touches. */
  function topBase(c, k) {
    const z0 = c.zMid + thickness(c.middle.length), z1 = c.zMid;
    if (k <= c.tClear) return z0;
    if (k >= c.tTouch) return z1;
    const q = (k - c.tClear) / (c.tTouch - c.tClear);
    return z0 - (z0 - z1) * q * q;
  }

  function frameAt(time) {
    const tt = Math.min(duration, Math.max(0, time));
    const stacks = [];
    const phase = phases.find((p) => tt >= p.t0 && tt < p.t1) || phases[phases.length - 1];
    const u = (p) => (tt - p.t0) / (p.t1 - p.t0);
    const z = { scale: zoom };
    const out = (list) => ({ t: tt, phase: tt >= duration ? "done" : phase.name, stacks: list });

    const fly = P("fly-in");
    if (tt < fly.t1) {
      // face-up (θ = π) → face-down (θ = 2π), travelling from the top-right and growing
      const k = u(fly), m = mj(k), st = flipState(k, { theta0: Math.PI });
      stacks.push({ ids: FULL_DECK, theta: st.theta, fx: lerp(start.fx, centre.fx, m), fy: lerp(start.fy, centre.fy, m), rise: st.lift - thickness(COUNT) / 2, scale: lerp(1, zoom, m) });
      return out(stacks);
    }
    // the middle-section cuts (and the rests between them)
    const lastCut = cutPhases[cutPhases.length - 1];
    if (tt < lastCut.t1) {
      const i = cutPhases.findIndex((p) => tt < p.t1);
      const p = cutPhases[i];
      if (tt < p.t0) {                                 // settle / pause before this pass
        const ids = i === 0 ? FULL_DECK : (() => { const c = cuts[i - 1]; return c.middle.concat(c.top, c.bottom); })();
        stacks.push({ ids, fx: centre.fx, fy: centre.fy, ...z });
        return out(stacks);
      }
      const c = cuts[i], k = u(p), pos = c.path.at(mj(k));
      if (k < c.tTouch) {
        stacks.push({ ids: c.bottom, fx: centre.fx, fy: centre.fy, ...z });
        stacks.push({ ids: c.top, fx: centre.fx, fy: centre.fy, baseZ: topBase(c, k), ...z });
      } else {
        stacks.push({ ids: c.top.concat(c.bottom), fx: centre.fx, fy: centre.fy, ...z });   // landed: one deck
      }
      stacks.push({ ids: c.middle, fx: centre.fx + pos.x, fy: centre.fy, baseZ: pos.z, ...z });
      return out(sortStacks(stacks));
    }
    const split = P("split");
    if (tt < split.t0) {
      stacks.push({ ids: order, fx: centre.fx, fy: centre.fy, ...z });
      return out(stacks);
    }
    if (tt < split.t1) {
      const k = u(split), m = mj(k);
      stacks.push({ ids: splitB, fx: lerp(centre.fx, pileB.fx, m), fy: lerp(centre.fy, pileB.fy, m), ...z });
      stacks.push({ ids: splitA, fx: lerp(centre.fx, pileA.fx, m), fy: lerp(centre.fy, pileA.fy, m), baseZ: lerp(thickness(splitB.length), 0, m) + 10 * arc(k), ...z });
      return out(stacks);
    }
    const shuf = P("shuffle");
    if (tt < P("fly-back").t0) {
      // piles A and B lose cards as they launch; C gains them as they land
      const elapsed = tt - shuf.t0;
      let remA = splitA.slice(), remB = splitB.slice();
      const landed = [], flying = [];
      launches.forEach((l, i) => {
        const t0 = i * Tm.launchEvery;
        if (elapsed < t0) return;
        if (l.from === "A") remA = remA.filter((x) => x !== l.id); else remB = remB.filter((x) => x !== l.id);
        if (elapsed >= t0 + Tm.flight) landed.push(l.id);
        else flying.push({ l, i, q: (elapsed - t0) / Tm.flight });
      });
      stacks.push({ ids: remA, fx: pileA.fx, fy: pileA.fy, ...z });
      stacks.push({ ids: remB, fx: pileB.fx, fy: pileB.fy, ...z });
      stacks.push({ ids: landed.slice().reverse(), fx: pileC.fx, fy: pileC.fy, ...z });
      for (const { l, i, q } of flying) {
        const src = l.from === "A" ? pileA : pileB;
        // leaves from the top of its pile (the cards still under it at launch) …
        const under = (l.from === "A" ? splitA : splitB).length - launches.slice(0, i + 1).filter((x) => x.from === l.from).length;
        // … and lands on top of the cards already on the third pile when it arrives
        const m = mj(q);
        stacks.push({ ids: [l.id], fx: lerp(src.fx, pileC.fx, m), fy: lerp(src.fy, pileC.fy, m), baseZ: lerp(thickness(under), thickness(i), m) + 18 * arc(q), ...z });
      }
      return out(sortStacks(stacks));
    }
    // fly to the deck's spot (top-left), shrinking to the original size
    const back = P("fly-back"), m = mj(u(back));
    stacks.push({ ids: finalOrder, fx: lerp(pileC.fx, end.fx, m), fy: lerp(pileC.fy, end.fy, m), scale: lerp(zoom, 1, m) });
    return out(stacks);
  }

  return { duration, phases, frameAt, finalOrder, cuts, layout: { start, end, centre, pileA, pileB, pileC, Wz } };
}

// painter's order: farther (smaller footprint y, lower) first; lifted cards come nearer
function sortStacks(stacks) {
  return stacks.filter((s) => s.ids.length).sort((p, q) => (p.fy + (p.baseZ || 0)) - (q.fy + (q.baseZ || 0)));
}
