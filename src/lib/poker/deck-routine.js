// The dealer's opening routine, as a pure timeline: frameAt(t) says where every card is.
//
// Owner's spec (2026-09-25): the deck starts face-up at its spot; flies to the table centre
// while turning over (the side-over flip) and growing ~1.6× ("closer to the user"); is cut
// three times (top part lifts off, slides aside, goes under — the deck ends whole); splits
// into two piles; cards leave the tops of the two piles one by one to a third pile — the
// shuffle — the three piles forming a triangle; the third pile (now the whole deck) flies back
// to the start spot and returns to its original size.
//
// Every move is minimum-jerk (zero speed and acceleration at both ends), like the flip. Each
// physical card keeps its id — and so its own edge strip — wherever it goes; the tests check
// that every frame holds each of the 52 cards exactly once and that nothing ever jumps.

import { W, H, COUNT, FLIP_MS, FULL_DECK, flipState, thickness } from "./deck3d.js";

const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
const arc = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; }; // 0→1→0, smooth ends
const lerp = (a, b, k) => a + (b - a) * k;
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const ZOOM = 1.6;
export const TIMING = {
  flyIn: FLIP_MS,        // flies to the centre, turns over, grows
  settle: 150,
  cut: 520,              // one cut: lift off + aside, the rest onto it, slide back
  cuts: 3,
  beforeSplit: 100,
  split: 500,
  beforeShuffle: 100,
  launchEvery: 45,       // a card leaves a pile every 45 ms …
  flight: 320,           // … and takes 320 ms to land on the third pile
  beforeReturn: 150,
  flyBack: 800
};

/**
 * Build the routine. start/centre are footprint centres in table units (1 unit = 1/60 card
 * width at normal size). Returns { duration, phases, frameAt(t), finalOrder, faceCardId }.
 */
export function buildRoutine({ start, centre, seed = 1, zoom = ZOOM, timing = TIMING } = {}) {
  const r = rng(seed);
  const Tm = timing;
  // layout at the centre, scaled with the zoom: aside spot for the cuts, the triangle
  const aside = { fx: centre.fx + zoom * W * 1.12, fy: centre.fy };
  // the triangle: piles never touch — the base piles sit a card-width-plus apart from the apex
  // horizontally, and a full card height below it
  const pileA = { fx: centre.fx - zoom * W * 1.15, fy: centre.fy + zoom * H * 0.45 };
  const pileB = { fx: centre.fx + zoom * W * 1.15, fy: centre.fy + zoom * H * 0.45 };
  const pileC = { fx: centre.fx, fy: centre.fy - zoom * H * 0.55 };  // the apex, toward the start spot

  // ---- plan the cards (deterministic for a seed) ----
  let order = FULL_DECK.slice();                         // top → bottom, face-down frame
  const cuts = [];
  for (let i = 0; i < Tm.cuts; i++) {
    const k = Math.round(COUNT * (0.35 + 0.3 * r()));      // top packet: 35–65% of the deck
    cuts.push({ top: order.slice(0, k), rest: order.slice(k) });
    order = order.slice(k).concat(order.slice(0, k));      // the top part goes under
  }
  const half = Math.round(COUNT / 2);
  const splitA = order.slice(0, half), splitB = order.slice(half);   // top half left, bottom half right
  // the shuffle: alternating runs of 1–3 cards from the tops of the two piles
  const a = splitA.slice(), b = splitB.slice(), launches = [];
  let side = r() < 0.5 ? "A" : "B";
  while (a.length || b.length) {
    const src = side === "A" ? a : b;
    const run = Math.min(src.length, [1, 1, 2, 2, 3][Math.floor(r() * 5)]);
    for (let i = 0; i < run; i++) launches.push({ id: src.shift(), from: side });
    side = side === "A" ? (b.length ? "B" : "A") : (a.length ? "A" : "B");
  }
  const finalOrder = launches.map((l) => l.id).reverse();  // last to land is on top

  // ---- phase boundaries ----
  const phases = [];
  let t = 0;
  const add = (name, dur) => { phases.push({ name, t0: t, t1: t + dur }); t += dur; };
  add("fly-in", Tm.flyIn);
  add("settle", Tm.settle);
  for (let i = 0; i < Tm.cuts; i++) add(`cut ${i + 1}`, Tm.cut);
  add("pause", Tm.beforeSplit);
  add("split", Tm.split);
  add("pause", Tm.beforeShuffle);
  const shuffleDur = (launches.length - 1) * Tm.launchEvery + Tm.flight;
  add("shuffle", shuffleDur);
  add("pause", Tm.beforeReturn);
  add("fly-back", Tm.flyBack);
  const duration = t;
  const P = (name) => phases.find((p) => p.name === name);

  // the card that shows while the deck is face-up at the start: the face-down deck's bottom card
  const faceCardId = FULL_DECK[COUNT - 1];

  function frameAt(time) {
    const tt = Math.min(duration, Math.max(0, time));
    const stacks = [];
    const phase = phases.find((p) => tt >= p.t0 && tt < p.t1) || phases[phases.length - 1];
    const u = (p) => (tt - p.t0) / (p.t1 - p.t0);

    const fly = P("fly-in");
    if (tt < fly.t1) {
      // face-up (θ = π) → face-down (θ = 2π), travelling and growing
      const k = u(fly), m = mj(k), st = flipState(k, { theta0: Math.PI });
      stacks.push({ ids: FULL_DECK, theta: st.theta, fx: lerp(start.fx, centre.fx, m), fy: lerp(start.fy, centre.fy, m), rise: st.lift - thickness(COUNT) / 2, scale: lerp(1, zoom, m) });
      return { t: tt, phase: phase.name, stacks };
    }
    const z = { scale: zoom };
    const firstCut = phases.findIndex((p) => p.name === "cut 1");
    const cutEnd = phases[firstCut + Tm.cuts - 1].t1;
    if (tt < phases[firstCut].t0) {
      stacks.push({ ids: FULL_DECK, fx: centre.fx, fy: centre.fy, ...z });
      return { t: tt, phase: phase.name, stacks };
    }
    if (tt < cutEnd) {
      const i = Math.min(Tm.cuts - 1, Math.floor((tt - phases[firstCut].t0) / Tm.cut));
      const p = phases[firstCut + i], k = u(p);
      const { top, rest } = cuts[i];
      const hTop = thickness(top.length), hRest = thickness(rest.length);
      if (k < 0.4) {
        // the top part lifts off and slides aside, landing on the table
        const q = k / 0.4, m = mj(q);
        stacks.push({ ids: rest, fx: centre.fx, fy: centre.fy, ...z });
        stacks.push({ ids: top, fx: lerp(centre.fx, aside.fx, m), fy: centre.fy, baseZ: lerp(hRest, 0, m) + 10 * arc(q), ...z });
      } else if (k < 0.8) {
        // the rest lifts onto it — the top part is now underneath
        const q = (k - 0.4) / 0.4, m = mj(q);
        stacks.push({ ids: top, fx: aside.fx, fy: aside.fy, ...z });
        stacks.push({ ids: rest, fx: lerp(centre.fx, aside.fx, m), fy: centre.fy, baseZ: lerp(0, hTop, m) + 10 * arc(q), ...z });
      } else {
        // the whole deck slides back to the centre
        const m = mj((k - 0.8) / 0.2);
        stacks.push({ ids: rest.concat(top), fx: lerp(aside.fx, centre.fx, m), fy: centre.fy, ...z });
      }
      return { t: tt, phase: phase.name, stacks };
    }
    const split = P("split");
    if (tt < split.t0) {
      stacks.push({ ids: order, fx: centre.fx, fy: centre.fy, ...z });
      return { t: tt, phase: phase.name, stacks };
    }
    if (tt < split.t1) {
      const k = u(split), m = mj(k);
      stacks.push({ ids: splitB, fx: lerp(centre.fx, pileB.fx, m), fy: lerp(centre.fy, pileB.fy, m), ...z });
      stacks.push({ ids: splitA, fx: lerp(centre.fx, pileA.fx, m), fy: lerp(centre.fy, pileA.fy, m), baseZ: lerp(thickness(splitB.length), 0, m) + 10 * arc(k), ...z });
      return { t: tt, phase: phase.name, stacks };
    }
    const shuf = P("shuffle");
    if (tt < shuf.t1 || tt < P("fly-back").t0) {
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
        stacks.push({
          ids: [l.id], fx: lerp(src.fx, pileC.fx, m), fy: lerp(src.fy, pileC.fy, m),
          baseZ: lerp(thickness(under), thickness(i), m) + 18 * arc(q), shadow: true, ...z
        });
      }
      return { t: tt, phase: phase.name, stacks: sortStacks(stacks) };
    }
    // fly back, shrinking to the original size
    const back = P("fly-back"), m = mj(u(back));
    stacks.push({ ids: finalOrder, fx: lerp(pileC.fx, start.fx, m), fy: lerp(pileC.fy, start.fy, m), scale: lerp(zoom, 1, m) });
    return { t: tt, phase: tt >= duration ? "done" : back.name, stacks };
  }

  return { duration, phases, frameAt, finalOrder, faceCardId, layout: { start, centre, aside, pileA, pileB, pileC } };
}

// painter's order: farther (smaller footprint y, lower) first; lifted cards come nearer
function sortStacks(stacks) {
  return stacks.filter((s) => s.ids.length).sort((p, q) => (p.fy + (p.baseZ || 0)) - (q.fy + (q.baseZ || 0)));
}
