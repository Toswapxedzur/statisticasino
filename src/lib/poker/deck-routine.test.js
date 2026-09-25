import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoutine, TIMING, ZOOM } from "./deck-routine.js";
import { COUNT, thickness } from "./deck3d.js";

const start = { fx: 350, fy: 62 }, centre = { fx: 350, fy: 245 };
const R = buildRoutine({ start, centre, seed: 7 });
const t1 = thickness(1);
// difference between two angles on the circle (2π and 0 are the same pose)
const angGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// each card's own position: its stack's footprint, and the height of the card's middle
function cardPositions(frame) {
  const pos = new Map();
  for (const s of frame.stacks) {
    const n = s.ids.length;
    s.ids.forEach((id, j) => {
      pos.set(id, { x: s.fx, y: s.fy, z: (s.baseZ || 0) + (s.rise || 0) + (n - 1 - j + 0.5) * t1, scale: s.scale ?? 1, theta: s.theta ?? 0 });
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

test("the fly-in turns the deck over, travels and grows, smoothly", () => {
  const a = R.frameAt(0).stacks[0], b = R.frameAt(TIMING.flyIn - 1e-6).stacks[0];
  assert.ok(Math.abs(a.theta - Math.PI) < 1e-9, "starts face-up");
  assert.ok(Math.abs(Math.cos(b.theta) - 1) < 1e-9, "ends face-down");
  assert.equal(a.scale, 1);
  assert.ok(Math.abs(b.scale - ZOOM) < 1e-9, "grows to the zoom");
  assert.ok(Math.abs(b.fx - centre.fx) < 1e-9 && Math.abs(b.fy - centre.fy) < 1e-9, "lands in the centre");
  let prev = a;
  for (let t = 1; t <= TIMING.flyIn; t++) {
    const s = R.frameAt(t).stacks[0];
    assert.ok(Math.hypot(s.fx - prev.fx, s.fy - prev.fy) < 2 && Math.abs(s.scale - prev.scale) < 0.01 && angGap(s.theta ?? 0, prev.theta ?? 0) < 0.02, `jump at t=${t}`);
    prev = s;
  }
});

test("three cuts, each moving the top part under the rest", () => {
  const cuts = R.phases.filter((p) => p.name.startsWith("cut "));
  assert.equal(cuts.length, 3);
  let order = R.frameAt(cuts[0].t0 - 0.001).stacks[0].ids;   // the whole deck just before
  for (const c of cuts) {
    const after = R.frameAt(c.t1 - 0.001).stacks;
    assert.equal(after.length, 1, "the deck ends whole");
    const k = order.indexOf(after[0].ids[0]);
    assert.ok(k > 0 && k < COUNT, "a real cut");
    assert.deepEqual(after[0].ids, order.slice(k).concat(order.slice(0, k)));
    order = after[0].ids;
  }
});

test("the shuffle alternates the two piles into a third, in a triangle", () => {
  const sh = R.phases.find((p) => p.name === "shuffle");
  const mid = R.frameAt((sh.t0 + sh.t1) / 2).stacks;
  const { pileA, pileB, pileC } = R.layout;
  assert.ok(pileC.fy < pileA.fy && pileA.fy === pileB.fy && pileA.fx < pileC.fx && pileC.fx < pileB.fx, "C is the apex above A and B");
  assert.ok(mid.some((s) => s.fx === pileA.fx) && mid.some((s) => s.fx === pileB.fx) && mid.some((s) => s.fx === pileC.fx));
  // runs of 1–3 from alternating piles
  const lastPiles = R.frameAt(sh.t1).stacks;
  assert.equal(lastPiles.filter((s) => s.ids.length).length, 1, "A and B are empty after the shuffle");
});

test("ends as one deck back at the start, original size", () => {
  const end = R.frameAt(R.duration).stacks;
  assert.equal(end.length, 1);
  assert.equal(end[0].ids.length, COUNT);
  assert.ok(Math.abs(end[0].fx - start.fx) < 1e-9 && Math.abs(end[0].fy - start.fy) < 1e-9);
  assert.ok(Math.abs(end[0].scale - 1) < 1e-9);
  assert.deepEqual(end[0].ids, R.finalOrder);
  assert.deepEqual([...R.finalOrder].sort((a, b) => a - b), Array.from({ length: COUNT }, (_, i) => i + 1));
});
