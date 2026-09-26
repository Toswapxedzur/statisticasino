// Every sound a table page makes, wired in one place. Call tableSounds(src) once while the page
// component initialises; src is a live getter object { view, me, dealer, bank, deadline }.
//  - moving cards / coins: the dealer's and the coin engine's landing cues, drained every frame into
//    the Web Audio scheduler (table-audio.js), so each hit lands on its frame;
//  - everything else (join, check, showdown, dice, …): the view diff (table-sfx.js), routed by routeCue;
//  - my turn: a ping when it starts, a tick a second in the last five, a quiet riffle when idle;
//  - a tournament / Sprint going live: a fanfare.
import { untrack } from "svelte";
import { play, playBurst } from "$lib/sfx.js";
import { tableSoundCues, routeCue } from "./table-sfx.js";
import { TableSounds, moneySound } from "./table-audio.js";

export function tableSounds(src) {
  const engine = new TableSounds();

  // the motion engines' landings, every frame
  $effect(() => {
    let raf = 0;
    const loop = () => {
      if (src.dealer) engine.take(src.dealer.cues);
      if (src.bank) engine.take(src.bank.money.cues, moneySound);
      engine.frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  // the view diff
  let prevView = null;
  $effect(() => {
    const v = src.view;
    const prev = prevView; prevView = v;
    if (!v || !prev || prev.id !== v.id) return;
    const animated = untrack(() => ({ cards: !!src.dealer, coins: !!src.bank }));
    for (const c of tableSoundCues(prev, v, untrack(() => src.me?.id ?? null))) {
      const r = routeCue(c, animated);
      if (!r) continue;
      if (r.table) engine.now(r.table, r.opts);
      else if (r.opts.count > 1) playBurst(r.sfx, r.opts.count, r.opts.gap, r.opts);
      else play(r.sfx, r.opts);
    }
  });

  // my turn starts (the server sends TABLE_TURN only to the acting player)
  let prevDeadline = null;
  $effect(() => {
    const dl = src.deadline;
    if (dl && dl !== prevDeadline) play("turn");
    prevDeadline = dl;
  });
  // the last five seconds of my clock: one tick per second; idle past 5 s: a quiet chip riffle
  $effect(() => {
    const dl = src.deadline;
    if (!dl) return;
    const t0 = Date.now();
    let last = -1;
    const tick = setInterval(() => {
      const left = Math.ceil((dl - Date.now()) / 1000);
      if (left <= 5 && left > 0 && left !== last) { last = left; play("tick"); }
      if (left <= 0) clearInterval(tick);
    }, 200);
    const idle = setInterval(() => { if (Date.now() - t0 >= 5000 && dl - Date.now() > 6000) play("think"); }, 7000);
    return () => { clearInterval(tick); clearInterval(idle); };
  });

  // a tournament / Sprint round goes live
  let prevStatus = null;
  $effect(() => {
    const st = src.view?.tournament?.status ?? null;
    if (prevStatus && st === "running" && prevStatus !== "running") play("fanfare");
    prevStatus = st;
  });
}
