<script>
  // The coins on the table, for every game mode: each seat's pile right beside its badge on the
  // side facing the centre (most valuable column against the badge, the amount after the
  // smallest), the pot's coins above the POT pill, and everything the bank moves between them
  // (bank.svelte.js → coin-motion.js). Positions come from the page every frame: badges carry
  // data-seat (the House data-house), the pot's coin spot data-pot-coins.
  import { onMount } from "svelte";
  import { coinSvg } from "$lib/poker/chips.js";
  import { COIN } from "$lib/poker/coin-motion.js";

  let { bank } = $props();
  let layer;

  const BASE = 18;                         // the table's coin size (inside the arena's zoom)
  const coinCache = new Map();
  const coin = (v, size) => {
    const k = v + "@" + size;
    if (!coinCache.has(k)) coinCache.set(k, `<span class="coin">${coinSvg(v, size)}</span>`);
    return coinCache.get(k);
  };
  function columnHTML(denom, count, size) {
    const n = Math.max(1, Math.min(count, 12)), rise = Math.max(2, Math.round(size * 0.14));
    let h = "";
    for (let k = 0; k < n; k++) h += `<span class="cc" style="bottom:${k * rise}px">${coin(denom, size)}</span>`;
    return `<span class="ccol" style="width:${size}px;height:${size + (n - 1) * rise}px">${h}</span>`;
  }

  // ---- geometry (layer px) ----
  let G = null;
  function measure() {
    const lr = layer.getBoundingClientRect();
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width) return null; return { l: r.left - lr.left, r: r.right - lr.left, t: r.top - lr.top, b: r.bottom - lr.top, cx: (r.left + r.right) / 2 - lr.left, cy: (r.top + r.bottom) / 2 - lr.top, el }; };
    const potEl = document.querySelector("[data-pot-coins]");
    const pot = box(potEl);
    const anyPlate = document.querySelector("[data-seat] .plate, [data-house] .plate");
    const zoom = anyPlate && anyPlate.offsetHeight ? anyPlate.getBoundingClientRect().height / anyPlate.offsetHeight : 1;
    const size = Math.round(BASE * zoom);
    const centre = pot ? { x: pot.cx, y: pot.cy } : { x: lr.width / 2, y: lr.height / 2 };
    const plates = new Map();
    const plate = (seat) => {
      if (plates.has(seat)) return plates.get(seat);
      const el = seat === "house" ? document.querySelector("[data-house] .plate") : document.querySelector(`[data-seat="${seat}"] .plate`);
      const b = box(el);
      plates.set(seat, b);
      return b;
    };
    const side = (seat) => { const b = plate(seat); return !b || b.cx <= centre.x + 1 ? 1 : -1; };
    return { lr, pot, size, pitch: size * 0.5, raise: size * 0.6, gap: Math.round(5 * zoom), centre, plate, side };
  }
  /** Where each column of a pile stands: denom → { x (centre), y (base), back (raised row) }. */
  function layoutOf(pile, denoms) {
    const out = new Map(), { size, pitch, raise, gap } = G;
    if (pile === "pot") {
      const p = G.pot ?? { cx: G.centre.x, b: G.centre.y };
      const width = size + Math.max(0, denoms.length - 1) * pitch;
      denoms.forEach((d, i) => out.set(d, { x: p.cx - width / 2 + size / 2 + i * pitch, y: p.b - (i % 2 ? raise : 0), back: i % 2 === 1 }));
      return out;
    }
    const seat = pile.slice(4) === "house" ? "house" : +pile.slice(4), b = G.plate(seat);
    if (!b) return out;
    const s = G.side(seat), x0 = s > 0 ? b.r + gap + size / 2 : b.l - gap - size / 2, base = b.cy + size * 0.55;
    denoms.forEach((d, i) => out.set(d, { x: x0 + s * i * pitch, y: base - (i % 2 ? raise : 0), back: i % 2 === 1 }));
    return out;
  }
  function pointOf(m, at) {
    if (at.kind === "stack") {
      const b = G.plate(at.seat);
      if (!b) return { x: G.centre.x, y: G.centre.y };
      const s = G.side(at.seat);
      return { x: s > 0 ? b.r - G.size * 0.5 : b.l + G.size * 0.5, y: b.cy + G.size * 0.55 };   // at the badge's edge
    }
    const ds = m.slotsOf(at.pile);
    if (!ds.includes(at.denom)) { ds.push(at.denom); ds.sort((a, b) => b - a); }
    return layoutOf(at.pile, ds).get(at.denom) ?? { x: G.centre.x, y: G.centre.y };
  }
  function labelOf(seat, denoms) {
    const b = G.plate(seat), s = G.side(seat);
    if (!b) return null;
    const lay = layoutOf(`bet:${seat}`, denoms), outer = lay.get(denoms[denoms.length - 1]);
    const x = outer ? outer.x + s * (G.size / 2 + G.gap) : (s > 0 ? b.r : b.l) + s * G.gap;
    return { x, y: b.cy + G.size * 0.1, ax: s > 0 ? 0 : -100 };
  }
  function potNumber() {
    const n = document.querySelector("[data-pot-number]");
    if (!n) return G.pot ? { x: G.pot.cx, y: G.pot.b + 14 } : G.centre;
    const r = n.getBoundingClientRect();
    return { x: (r.left + r.right) / 2 - G.lr.left, y: (r.top + r.bottom) / 2 - G.lr.top };
  }

  // ---- drawing ----
  const colEls = new Map(), flightEls = new Map(), labelEls = new Map();
  let last = null;
  function node(cls) { const e = document.createElement("div"); e.className = cls; layer.appendChild(e); return e; }
  function place(e, tf, op = "1") {
    if (e._tf !== tf) { e._tf = tf; e.style.transform = tf; }
    if (e._op !== op) { e._op = op; e.style.opacity = op; }
  }

  function frame(t) {
    if (!layer || !bank) return;
    bank.tick(t);
    const m = bank.money;
    G = measure();
    const dt = last == null ? Infinity : Math.min(100, t - last);
    last = t;
    const k = 1 - Math.exp(-dt / 70);        // columns glide when one appears or leaves
    const size = G.size;
    // resting columns
    const live = new Set();
    for (const pile of m.piles.keys()) {
      const cols = new Map(m.columnsOf(pile)), lay = layoutOf(pile, m.slotsOf(pile));
      for (const [d, pos] of lay) {
        const n = cols.get(d) || 0;
        if (!n) continue;
        const id = `${pile}|${d}`;
        live.add(id);
        let c = colEls.get(id);
        if (!c) { c = { el: node("col"), x: pos.x, y: pos.y, key: "" }; colEls.set(id, c); }
        c.x += (pos.x - c.x) * k; c.y += (pos.y - c.y) * k;
        const key = `${d}x${n}@${size}`;
        if (c.key !== key) { c.key = key; c.el.innerHTML = columnHTML(d, n, size); }
        place(c.el, `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%)`);
        c.el.style.zIndex = pos.back ? "1" : "2";
      }
    }
    for (const [id, c] of [...colEls]) if (!live.has(id)) { c.el.remove(); colEls.delete(id); }
    // flights
    const liveF = new Set();
    for (const f of m.flights) {
      liveF.add(f.id);
      const st = m.flightAt(f, t), a = pointOf(m, f.from), b = pointOf(m, f.to);
      let denom = f.denom, count = f.count;
      if (f.kind === "merge") { count = Math.max(1, Math.round(f.count - (f.count - 1) * st.s)); if (st.s > 0.5) denom = f.toDenom; }
      if (f.kind === "break") { count = Math.max(1, Math.round(1 + (f.toCount - 1) * st.s)); if (st.s > 0.5) denom = f.toDenom; }
      let r = flightEls.get(f.id);
      if (!r) { r = { el: node("flight"), key: "" }; flightEls.set(f.id, r); }
      const key = `${denom}x${count}@${size}`;
      if (r.key !== key) { r.key = key; r.el.innerHTML = columnHTML(denom, count, size); }
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const lift = f.kind === "column" ? Math.min(60, COIN.arc * dist) : size * 0.9;
      // leaving a badge: grow out of its edge; reaching one: sink into it
      const grow = f.from.kind === "stack" ? Math.min(1, st.u / 0.18) : 1;
      const x = a.x + (b.x - a.x) * st.s, y = a.y + (b.y - a.y) * st.s - lift * st.lift;
      place(r.el, `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${(grow * (1 - 0.75 * st.sink)).toFixed(3)})`, String(Math.min(grow, 1 - st.sink)));
    }
    for (const [id, r] of [...flightEls]) if (!liveF.has(id)) { r.el.remove(); flightEls.delete(id); }
    // the amounts beside the piles; swept ones ride into the pot's number
    const liveL = new Set();
    for (const pile of m.piles.keys()) {
      if (!pile.startsWith("bet:")) continue;
      const amount = m.pileAt(pile);
      const seat = pile.slice(4) === "house" ? "house" : +pile.slice(4), p = amount ? labelOf(seat, m.slotsOf(pile)) : null;
      if (!p) continue;
      liveL.add(pile);
      let e = labelEls.get(pile);
      if (!e) { e = node("amt"); labelEls.set(pile, e); }
      const txt = amount.toLocaleString();
      if (e.textContent !== txt) e.textContent = txt;
      place(e, `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(${p.ax}%, -50%)`);
    }
    const pn = potNumber();
    m.sweeps.forEach((s, i) => {
      if (t < s.t0 || t >= s.t0 + s.dur) return;
      const a = labelOf(s.seat, s.cols.map(([d]) => d));
      if (!a) return;
      const key = `sweep:${i}`;
      liveL.add(key);
      const st = m.flightAt({ t0: s.t0, dur: s.dur }, t);
      const x = a.x + (pn.x - a.x) * st.s, y = a.y + (pn.y - a.y) * st.s - Math.min(60, COIN.arc * Math.hypot(pn.x - a.x, pn.y - a.y)) * st.lift * 0.35;
      const fade = Math.min(1, Math.max(0, (st.u - 0.8) / 0.2));     // melts into the pot's number
      let e = labelEls.get(key);
      if (!e) { e = node("amt"); labelEls.set(key, e); }
      const txt = s.amount.toLocaleString();
      if (e.textContent !== txt) e.textContent = txt;
      place(e, `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${(a.ax + (-50 - a.ax) * st.s).toFixed(1)}%, -50%) scale(${(1 - 0.2 * fade).toFixed(3)})`, String(1 - fade));
    });
    for (const [key, e] of [...labelEls]) if (!liveL.has(key)) { e.remove(); labelEls.delete(key); }
  }

  onMount(() => {
    let raf = 0, alive = true;
    const loop = (t) => { if (!alive) return; frame(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  });
</script>

<div class="money-layer" bind:this={layer} aria-hidden="true"></div>

<style>
  .money-layer { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }
  .money-layer :global(.col), .money-layer :global(.flight) { position: absolute; left: 0; top: 0; line-height: 0; will-change: transform; }
  .money-layer :global(.flight) { z-index: 5; will-change: transform, opacity; }
  .money-layer :global(.ccol) { position: relative; display: block; }
  .money-layer :global(.cc) { position: absolute; left: 0; display: block; line-height: 0; }
  .money-layer :global(.coin) { display: inline-block; line-height: 0; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45)); }
  .money-layer :global(.coin svg) { display: block; }
  .money-layer :global(.amt) {
    position: absolute; left: 0; top: 0; z-index: 4; white-space: nowrap; line-height: 1; will-change: transform, opacity;
    font-size: 12px; font-weight: 800; color: var(--gold-ink); font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, var(--surface) 78%, #000 22%); border-radius: 999px; padding: 3px 7px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  }
</style>
