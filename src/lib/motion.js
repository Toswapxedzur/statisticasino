// Shared motion constants + helpers for the whole app, so every transition
// reads from one place and one flag (prefers-reduced-motion) disables them all.
import { cubicOut } from "svelte/easing";

// Durations (ms) — mirror the CSS --dur tokens in app.css.
export const DUR = { fast: 140, base: 220, slow: 380 };
export const ease = cubicOut;

// True when the viewer asked for reduced motion — call at runtime before
// starting a JS-driven animation (view transitions, count-up tweens).
export function reducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Duration helper: collapses to 0 under reduced motion so directives no-op.
export function d(ms) {
  return reducedMotion() ? 0 : ms;
}

// Standard enter/exit tuning for list items (fly) — kept consistent app-wide.
export const listIn = { y: 8, duration: DUR.base };
export const listOut = { duration: DUR.fast };
