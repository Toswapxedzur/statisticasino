import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoutine, TIMING, ZOOM, UTURN } from "./deck-routine.js";
import { COUNT, W, thickness } from "./deck3d.js";

// the real layout: face-up pile top-right, deck top-left, both just below the top bar
const start = { fx: 640, fy: 93 }, end = { fx: 60, fy: 93 }, centre = { fx: 350, fy: 240 };
const R = buildRoutine({ start, end, centre, seed: 7 });
const t1 = thickness(1);
// difference between two angles on the circle (2π and 0 are the same pose)
const angGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// each card's own position: its stack's footprint, and the height of the card's middle
function cardPositions(frame) {
  const pos = new Map();
  for (const s of frame.stacks) {
    const n = s.ids.length;
    s.ids.forEach((id, j) => {
      pos.set(id, { x: s.fx, y: s.fy, z: (s.baseZ || 0) + (s.rise || 0) + (n - 1 - j + 0.5) * t1, scale: s.scale ?? 1 });
    });
  }
  return pos;
}

test("every frame holds each of the 52 cards exactly once", () => {
  for (let t = 0; t <= R.duration; t += 5) {
    const ids = R.frameAt(t).stacks.flatMap((s) => s.ids);
    assert.equal(ids.length, COUNT, `t=${t}: ${ids.length} cards`);
    assert.equal(new Set(ids).size, COUNT, `t=${t}: a card appears twice`);
  }
});

test("no card ever jumps (checked every millisecond after the fly-in)", () => {
  const flyEnd = R.phases.find((p) => p.name === "fly-in").t1;
  let prev = cardPositions(R.frameAt(flyEnd)), worst = { d: 0 };
  for (let t = flyEnd + 1; t <= R.duration; t += 1) {
    const cur = cardPositions(R.frameAt(t));
    for (const [id, p] of cur) {
      const q = prev.get(id);
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) + Math.abs(p.scale - q.scale) * 60;
      if (d > worst.d) worst = { d, id, t, phase: R.frameAt(t).phase };
    }
    prev = cur;
  }
  assert.ok(worst.d < 2, `card ${worst.id} jumped ${worst.d.toFixed(2)} units at t=${worst.t} (${worst.phase})`);
});

test("fly-in: from the face-up pile top-right to the centre, turning over and growing", () => {
  const a = R.frameAt(0).stacks[0], b = R.frameAt(TIMING.flyIn - 1e-6).stacks[0];
  assert.ok(Math.abs(a.theta - Math.PI) < 1e-9, "starts face-up");
  assert.deepEqual([a.fx, a.fy], [start.fx, start.fy], "starts at the top-right pile");
  assert.ok(Math.abs(Math.cos(b.theta) - 1) < 1e-9, "ends face-down");
  assert.ok(Math.abs(b.scale - ZOOM) < 1e-9 && Math.abs(b.fx - centre.fx) < 1e-9 && Math.abs(b.fy - centre.fy) < 1e-9);
  let prev = a;
  for (let t = 1; t <= TIMING.flyIn; t++) {
    const s = R.frameAt(t).stacks[0];
    assert.ok(Math.hypot(s.fx - prev.fx, s.fy - prev.fy) < 2 && Math.abs(s.scale - prev.scale) < 0.01 && angGap(s.theta ?? 0, prev.theta ?? 0) < 0.02, `jump at t=${t}`);
    prev = s;
  }
});

test("three middle-section cuts: middle ends on top, a different section each time", () => {
  const cuts = R.phases.filter((p) => p.name.startsWith("cut "));
  assert.equal(cuts.length, 3);
  const seen = new Set();
  R.cuts.forEach((c, i) => {
    assert.ok(c.top.length && c.middle.length && c.bottom.length, "three real sections");
    seen.add(`${c.top.length}/${c.middle.length}`);
    const after = R.frameAt(cuts[i].t1 - 0.001).stacks;
    const all = after.flatMap((s) => s.ids);
    assert.deepEqual(all.length, COUNT);
    // just before the pass ends the middle is sliding on; right after, the deck is whole
    const whole = R.frameAt(cuts[i].t1 + 0.001).stacks;
    assert.equal(whole.length, 1, "the deck ends whole");
    assert.deepEqual(whole[0].ids, c.middle.concat(c.top, c.bottom), "middle section on top");
  });
  assert.ok(seen.size >= 2, "the sections differ between passes");
});

test("the top lands exactly as the middle's left edge touches the deck's right edge", () => {
  const { Wz } = R.layout;
  R.phases.filter((p) => p.name.startsWith("cut ")).forEach((p, i) => {
    const c = R.cuts[i];
    const tTouch = p.t0 + c.tTouch * (p.t1 - p.t0);
    const before = R.frameAt(tTouch - 1e-6).stacks;
    const mid = before.find((s) => s.ids[0] === c.middle[0]);
    const top = before.find((s) => s.ids[0] === c.top[0]);
    assert.ok(Math.abs(mid.fx - centre.fx - Wz) < 1e-3, `pass ${i + 1}: middle's left edge at the deck's right edge (${(mid.fx - centre.fx - Wz).toFixed(4)})`);
    assert.ok(Math.abs(top.baseZ - c.zMid) < 1e-3, `pass ${i + 1}: the top has just landed (${(top.baseZ - c.zMid).toFixed(4)})`);
    // and it didn't start falling before the middle had cleared the deck
    const tClear = p.t0 + c.tClear * (p.t1 - p.t0);
    const early = R.frameAt(tClear - 5).stacks.find((s) => s.ids[0] === c.top[0]);
    assert.ok(Math.abs(early.baseZ - (c.zMid + thickness(c.middle.length))) < 1e-9, "top still held up while the middle is under it");
  });
});

test("U-turn: far point 1.5 card widths out (a 50% gap), and no packet ever passes through another", () => {
  const { Wz } = R.layout;
  R.phases.filter((p) => p.name.startsWith("cut ")).forEach((p, i) => {
    const c = R.cuts[i];
    let far = 0;
    for (let t = p.t0; t < p.t1; t += 0.5) {
      const st = R.frameAt(t).stacks;
      const mid = st.find((s) => s.ids[0] === c.middle[0]);
      const dx = mid.fx - centre.fx;
      far = Math.max(far, dx);
      if (dx < Wz - 1e-6) {
        // overlapping the deck from above: the middle's slab must sit exactly between the others
        const zLo = mid.baseZ, zHi = zLo + thickness(c.middle.length);
        for (const s of st) {
          if (s === mid) continue;
          const sLo = s.baseZ || 0, sHi = sLo + thickness(s.ids.length);
          assert.ok(zHi <= sLo + 1e-6 || zLo >= sHi - 1e-6, `pass ${i + 1} t=${t.toFixed(1)}: middle [${zLo.toFixed(2)},${zHi.toFixed(2)}] intersects [${sLo.toFixed(2)},${sHi.toFixed(2)}]`);
        }
      }
    }
    assert.ok(Math.abs(far - UTURN * Wz) < 0.5, `far point ${(far / Wz).toFixed(3)} card widths`);
    assert.ok(Math.abs(far - Wz - 0.5 * W * ZOOM) < 0.5, "gap of half a card width");
  });
});

test("the shuffle: two piles into a third, in a triangle", () => {
  const sh = R.phases.find((p) => p.name === "shuffle");
  const mid = R.frameAt((sh.t0 + sh.t1) / 2).stacks;
  const { pileA, pileB, pileC } = R.layout;
  assert.ok(pileC.fy < pileA.fy && pileA.fy === pileB.fy && pileA.fx < pileC.fx && pileC.fx < pileB.fx, "C is the apex above A and B");
  assert.ok(mid.some((s) => s.fx === pileA.fx) && mid.some((s) => s.fx === pileB.fx) && mid.some((s) => s.fx === pileC.fx));
  assert.equal(R.frameAt(sh.t1).stacks.filter((s) => s.ids.length).length, 1, "A and B are empty after the shuffle");
});

test("ends as one face-down deck at the top-left, original size", () => {
  const e = R.frameAt(R.duration).stacks;
  assert.equal(e.length, 1);
  assert.equal(e[0].ids.length, COUNT);
  assert.ok(Math.abs(e[0].fx - end.fx) < 1e-9 && Math.abs(e[0].fy - end.fy) < 1e-9, "at the deck's spot");
  assert.ok(Math.abs(e[0].scale - 1) < 1e-9);
  assert.ok(Math.abs(Math.cos(e[0].theta ?? 0) - 1) < 1e-9, "face-down");
  assert.deepEqual([...R.finalOrder].sort((a, b) => a - b), Array.from({ length: COUNT }, (_, i) => i + 1));
});
