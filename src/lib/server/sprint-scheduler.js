// River Sprint scheduler — keeps the daily rounds flowing. On each tick it:
//   1. ensures the day's (and tomorrow's) rounds exist,
//   2. opens registration on rounds entering their lead window,
//   3. starts + runs any round whose time has come, finishing it with the
//      standings the pool `runner` returns.
//
// In-process and single-instance: the caller starts it only where the poker
// lease is held (same discipline as the hub), so two servers can't double-run a
// round. The pool engine is injected as `runner(round) -> Promise<standings>`,
// keeping this timing logic decoupled and testable. Clock is injectable too.

import * as sprint from "./sprint.js";
import { SPRINT } from "./sprint-core.js";

// Two rounds a day at fixed UTC hours (timezone split): ~02:00 UTC serves
// Asia-Pacific evening / Americas night, ~14:00 UTC serves Americas morning /
// Europe afternoon.
export const ROUND_HOURS_UTC = [2, 14];
export const REG_LEAD_MS = 20 * 60 * 1000; // registration opens 20m before start

// The scheduled start timestamps for the UTC day containing `at`.
export function dayRoundTimes(at) {
  const d = new Date(at);
  return ROUND_HOURS_UTC.map((h) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h));
}

// Ensure today's and tomorrow's rounds exist (so one is always visible ahead).
// Skips slots already fully in the past. Returns the rounds it created.
export async function ensureRounds(at, deps = {}) {
  const { db } = deps;
  const times = [...dayRoundTimes(at), ...dayRoundTimes(at + 86400000)];
  const created = [];
  for (const t of times) {
    if (t + SPRINT.DURATION_MS < at) continue; // window already elapsed
    if (await sprint.findRoundAt(t, db)) continue;
    const id = await sprint.createRound({ scheduledAt: t }, db);
    created.push({ id, scheduledAt: t });
  }
  return created;
}

// Flip scheduled -> registering for rounds inside the lead window.
export async function openRegistrations(at, deps = {}) {
  const { db } = deps;
  const rounds = await sprint.nextRounds(10, db);
  for (const r of rounds) {
    if (r.status === "scheduled" && r.scheduled_at - at <= REG_LEAD_MS) {
      await sprint.setStatus(r.id, "registering", db);
    }
  }
}

// Start + run any due round. A round with no human entrants is canceled (nothing
// to play for); otherwise it goes live, the runner plays it out, and finishRound
// distributes prizes from the returned standings. A runner failure ends the round
// with an empty field (no payouts) rather than leaving it stuck 'live'.
export async function runDue(at, runner, deps = {}) {
  const { db, wallet } = deps;
  const due = await sprint.roundsToStart(at, db);
  const ran = [];
  for (const r of due) {
    if (!Number(r.entrants)) { await sprint.cancelRound(r.id, db, wallet); ran.push({ id: r.id, canceled: true }); continue; }
    await sprint.setStatus(r.id, "live", db, { startedAt: at });
    let standings = [];
    try { standings = (await runner(r)) || []; }
    catch { standings = []; }
    const res = await sprint.finishRound(r.id, standings, db, wallet, Date.now());
    ran.push({ id: r.id, ...res });
  }
  return ran;
}

// One scheduler pass.
export async function tick(at, runner, deps = {}) {
  await ensureRounds(at, deps);
  await openRegistrations(at, deps);
  return runDue(at, runner, deps);
}

// Start the periodic scheduler. Returns a stop() handle. `runner` is the pool
// engine. Ticks every `intervalMs` (and once immediately). Errors are swallowed
// per-tick so a transient DB blip never kills the loop.
export function startScheduler(runner, { intervalMs = 30_000 } = {}) {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try { await tick(Date.now(), runner); }
    catch (e) { console.error("[bluffing-valley] sprint scheduler tick error:", e?.message || e); }
  };
  run();
  const h = setInterval(run, intervalMs);
  h.unref?.();
  return () => { stopped = true; clearInterval(h); };
}
