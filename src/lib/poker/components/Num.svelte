<script>
  // A number that counts up/down smoothly when its value changes (chips, stacks,
  // pots, wallets). Drop-in for `{n.toLocaleString()}` — renders no wrapper so it
  // inherits the surrounding style. Snaps instantly under reduced motion.
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { reducedMotion, DUR } from "$lib/motion.js";

  let { value = 0 } = $props();

  const t = tweened(Number(value) || 0, {
    duration: reducedMotion() ? 0 : DUR.slow,
    easing: cubicOut,
  });
  // Animate toward each new value; the first (equal) set is a no-op so it never
  // counts up from zero on mount.
  $effect(() => { t.set(Number(value) || 0); });
</script>{Math.round($t).toLocaleString()}