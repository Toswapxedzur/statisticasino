<script>
  // A metal coin, viewed AT AN ANGLE with depth (like a casino chip), in FLAT
  // colours — NO gradients anywhere. Lighting is done the Casino.org way: the
  // face is split into a lit region and a shadow region, and in the lit region
  // every colour is a flat BRIGHTER version (hard edge, no blend). SVG, no image.
  // Detail scales with render size — same model as the card deck:
  //   · small  → the angled disc in one solid colour (+ darker edge for depth).
  //   · medium → top face = outer ring (one colour) + inner circle (another).
  //   · large  → + a small 45° rhombus, split into two triangles darker than base.
  import { chipTier } from "$lib/poker/chips.js";

  let { value = 0, size = 20 } = $props();
  let t = $derived(chipTier(value));
  let form = $derived(size < 20 ? 1 : size < 34 ? 2 : 3);

  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const hex = (r, g, b) => "#" + ((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1);
  const parse = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const darken = (h, f) => { const [r, g, b] = parse(h); return hex(r * (1 - f), g * (1 - f), b * (1 - f)); };
  const lighten = (h, f) => { const [r, g, b] = parse(h); return hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); };

  const L = 0.30; // lit-region brightening
  let outer = $derived(t.base);
  let inner = $derived(darken(t.base, 0.22));
  let edge = $derived(darken(t.base, 0.5));
  let tri1 = $derived(darken(t.base, 0.38));
  let tri2 = $derived(darken(t.base, 0.58));
  let id = $derived(t.name);
</script>

<span class="coin" style="--sz:{size}px" aria-hidden="true">
  <svg viewBox="0 0 100 100" width={size} height={size}>
    <defs>
      <!-- lit region: a circle toward the top-left; its interior is brighter -->
      <clipPath id="lit-{id}"><circle cx="-38" cy="-38" r="52" /></clipPath>
    </defs>
    <!-- edge / depth: side band + bottom cap (behind the face) -->
    <rect x="4" y="40" width="92" height="18" fill={edge} />
    <ellipse cx="50" cy="58" rx="46" ry="32" fill={edge} />
    <!-- top face, foreshortened by the tilt (~0.7) -->
    <g transform="translate(50 40) scale(1 0.696)">
      <!-- base (shadow) tones -->
      <circle r="46" fill={outer} />
      {#if form >= 2}<circle r="31" fill={inner} />{/if}
      {#if form >= 3}
        <polygon points="0,-16 -16,0 0,16" fill={tri1} />
        <polygon points="0,-16 16,0 0,16" fill={tri2} />
      {/if}
      <!-- lit copy: same shapes, brighter, clipped to the lit region (hard edge) -->
      <g clip-path="url(#lit-{id})">
        <circle r="46" fill={lighten(outer, L)} />
        {#if form >= 2}<circle r="31" fill={lighten(inner, L)} />{/if}
        {#if form >= 3}
          <polygon points="0,-16 -16,0 0,16" fill={lighten(tri1, L)} />
          <polygon points="0,-16 16,0 0,16" fill={lighten(tri2, L)} />
        {/if}
      </g>
    </g>
  </svg>
</span>

<style>
  .coin {
    display: inline-block;
    width: var(--sz);
    height: var(--sz);
    flex: 0 0 auto;
    line-height: 0;
    filter: drop-shadow(0 calc(var(--sz) * 0.03) calc(var(--sz) * 0.05) rgba(0, 0, 0, 0.45));
  }
  .coin svg { display: block; }
</style>
