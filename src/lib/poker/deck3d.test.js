import { test } from "node:test";
import assert from "node:assert/strict";
import { flipState, halfExtent, T, FLIP_MS, LIFT_PEAK, STAGE } from "./deck3d.js";

const N = 9000; // 0.1 ms steps over a 0.9 s flip
const samples = Array.from({ length: N + 1 }, (_, i) => flipState(i / N));
const dt = FLIP_MS / 1000 / N;

test("starts and ends at rest, flat on the table", () => {
  for (const st of [samples[0], samples[N]]) {
    assert.ok(Math.abs(st.omega) < 1e-12, "angular speed zero");
    assert.ok(Math.abs(st.alpha) < 1e-12, "angular acceleration zero");
    assert.ok(Math.abs(st.vLift) < 1e-12, "not rising or falling");
    assert.ok(Math.abs(st.lift - T / 2) < 1e-12, "resting on the table");
  }
  assert.ok(Math.abs(samples[0].theta) < 1e-12);
  assert.ok(Math.abs(samples[N].theta - Math.PI) < 1e-12, "turned exactly over");
});

test("the deck never touches the table mid-flip", () => {
  const worst = Math.min(...samples.slice(1, -1).map((s) => s.clearance));
  assert.ok(worst >= 0, `lowest corner dips ${worst} units into the table`);
  assert.ok(samples[N / 2].clearance > 4, "clear gap at mid-flip");
  assert.ok(Math.abs(samples[N / 2].lift - LIFT_PEAK) < 1e-9, "peak height at mid-flip");
});

test("rotation never reverses and peaks at mid-flip", () => {
  for (let i = 1; i <= N; i++) assert.ok(samples[i].theta >= samples[i - 1].theta);
  const peak = samples.reduce((a, b) => (b.omega > a.omega ? b : a));
  assert.ok(Math.abs(peak.u - 0.5) < 1e-3, "fastest halfway through");
  assert.ok(Math.abs(peak.omega - (Math.PI * 1.875) / (FLIP_MS / 1000)) < 1e-6);
});

test("speed and acceleration are consistent and continuous (no jolts)", () => {
  let maxJumpW = 0, maxJumpA = 0, maxErrW = 0, maxErrA = 0;
  for (let i = 1; i < N; i++) {
    const [a, b, c] = [samples[i - 1], samples[i], samples[i + 1]];
    maxErrW = Math.max(maxErrW, Math.abs((c.theta - a.theta) / (2 * dt) - b.omega));
    maxErrA = Math.max(maxErrA, Math.abs((c.omega - a.omega) / (2 * dt) - b.alpha));
    maxJumpW = Math.max(maxJumpW, Math.abs(b.omega - a.omega));
    maxJumpA = Math.max(maxJumpA, Math.abs(b.alpha - a.alpha));
  }
  assert.ok(maxErrW < 1e-4, `ω matches dθ/dt (err ${maxErrW})`);
  assert.ok(maxErrA < 1e-3, `α matches dω/dt (err ${maxErrA})`);
  assert.ok(maxJumpW < 0.01, `ω changes smoothly (max step ${maxJumpW} rad/s per 0.1 ms)`);
  assert.ok(maxJumpA < 0.1, `α changes smoothly (max step ${maxJumpA} rad/s² per 0.1 ms)`);
});

test("angular momentum and torque follow L = Iω and τ = Iα", () => {
  const st = samples[N / 4];
  assert.ok(Math.abs(st.L / st.omega - st.torque / st.alpha) < 1e-15);
  assert.ok(st.L > 0 && st.torque > 0, "spinning up in the first half");
  assert.ok(samples[(3 * N) / 4].torque < 0, "braking in the second half");
});

test("half-extent is the deck's own geometry", () => {
  assert.equal(halfExtent(0), T / 2);
  assert.equal(halfExtent(Math.PI / 2), 30);
  assert.ok(STAGE.above > 0 && STAGE.side > 0);
});
