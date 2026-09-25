<script>
  // The canvas over the table that draws the dealer's world: the face-down deck top-left and
  // the face-up used pile top-right (each ~70% buried past the screen edge, 30% showing, just below the top bar —
  // owner's rule), every card flying between them and the seats / board, and the shuffle
  // routine between hands. Positions come from the real DOM every frame (the seat and board
  // slots carry data-seat / data-slot / data-board-slot), so zoom and resizes never misalign.
  import { onMount } from "svelte";
  import { drawStack, drawStackShadow, W, H, T, thickness } from "$lib/poker/deck3d.js";
  import { renderBack, renderBoard } from "$lib/poker/composer.js";

  let { dealer } = $props();
  let canvas;

  // ---- card art: composer SVG → image (SVG images can't fetch, so /deck-parts hrefs are inlined)
  const svgCache = new Map();
  async function toImage(markup, px = 480) {
    let svg = markup.match(/<svg[\s\S]*<\/svg>/)[0];
    for (const [, file] of svg.matchAll(/href="\/deck-parts\/([^"]+)"/g)) {
      if (!svgCache.has(file)) {
        const txt = await (await fetch(`/deck-parts/${file}`)).text();
        svgCache.set(file, "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(txt))));
      }
      svg = svg.replaceAll(`href="/deck-parts/${file}"`, `href="${svgCache.get(file)}"`);
    }
    svg = svg.replace(/width="\d+" height="\d+"/, `width="${px}" height="${Math.round((px * H) / W)}"`);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await img.decode();
    return img;
  }
  let back = null;
  const lastSeen = new Map();
  const faceImgs = new Map(), loading = new Set();
  function faceImg(card) {
    if (!card) return null;
    const got = faceImgs.get(card);
    if (got) return got;
    if (!loading.has(card)) {
      loading.add(card);
      toImage(renderBoard(card, 60, { edge: false })).then((img) => faceImgs.set(card, img)).catch(() => {});
    }
    return null;
  }

  // ---- geometry, measured from the page every frame ----
  function measure() {
    const cr = canvas.getBoundingClientRect();
    const rect = (el) => { const r = el.getBoundingClientRect(); if (!r.width) return null; return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2, w: r.width }; };
    const q = (sel) => { const el = document.querySelector(sel); return el ? rect(el) : null; };
    const b0 = q('[data-board-slot="0"]');
    const cw = b0?.w || 82;                         // the table's card width on screen
    const k = cw / W;                               // px per drawing unit (a card is 60 units wide)
    const hud = document.querySelector(".hud");
    const hudBottom = hud ? hud.getBoundingClientRect().bottom - cr.top : 48;
    // a full deck's top card starts just below the bar: its top edge is at fy − H/2 − T
    const fy = (hudBottom + 6) / k + H / 2 + T;
    // owner's rule: 70% of the card buried past the edge, 30% showing (centre 0.2 card-widths out)
    const deckSpot = { fx: (-0.2 * cw) / k, fy };                   // 70% past the left edge
    const usedSpot = { fx: (cr.width + 0.2 * cw) / k, fy };          // 70% past the right edge
    const mid = q('[data-board-slot="2"]');
    const centre = mid ? { fx: mid.x / k, fy: mid.y / k } : { fx: cr.width / 2 / k, fy: cr.height / 2 / k };
    // last-known spot of each slot: a hand won without a showdown leaves the DOM at once
    const seen = (key, r) => { if (r) lastSeen.set(key, r); return r || lastSeen.get(key) || null; };
    const place = (at) => {
      if (at.kind === "deck") return { fx: deckSpot.fx, fy: deckSpot.fy, baseZ: thickness(dealer.deck.length), scale: 1 };
      if (at.kind === "used") return { fx: usedSpot.fx, fy: usedSpot.fy, baseZ: thickness(dealer.used.length), scale: 1 };
      const r = at.kind === "seat"
        ? seen(`s${at.seat}.${at.slot}`, q(`[data-seat="${at.seat}"] [data-slot="${at.slot}"]`)) || q(`[data-seat="${at.seat}"]`)
        : seen(`b${at.slot}`, q(`[data-board-slot="${at.slot}"]`));
      if (!r) return { fx: centre.fx, fy: centre.fy, baseZ: 0, scale: 1 };
      return { fx: r.x / k, fy: r.y / k, baseZ: 0, scale: r.w / cw };
    };
    return { cr, k, deckSpot, usedSpot, centre, place };
  }

  // ---- drawing ----
  const mj = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * k * (10 + k * (-15 + 6 * k)); };
  const bump = (u) => { const k = Math.min(1, Math.max(0, u)); return 64 * (k * (1 - k)) ** 3; };
  const lerp = (a, b, t) => a + (b - a) * t;
  let dpr = 1;

  function frame(t) {
    if (!canvas || !dealer) return;
    dealer.tick(t);
    const g = measure();
    dealer.geom = { deckSpot: g.deckSpot, usedSpot: g.usedSpot, centre: g.centre };
    dpr = window.devicePixelRatio || 1;
    const wpx = Math.round(g.cr.width * dpr), hpx = Math.round(g.cr.height * dpr);
    if (canvas.width !== wpx || canvas.height !== hpx) { canvas.width = wpx; canvas.height = hpx; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * g.k, 0, 0, dpr * g.k, 0, 0);

    const faceOf = (id) => faceImg(dealer.faces.get(id));
    // resting piles (or the routine, which owns every card while it plays; its own order)
    const resting = [];
    if (dealer.routine) {
      const r = dealer.routine;
      const face = faceImg(r.face);
      for (const s of r.R.frameAt(t - r.t0).stacks) resting.push({ ...s, art: { back, face } });
    } else {
      if (dealer.deck.length) resting.push({ ids: dealer.deck, fx: g.deckSpot.fx, fy: g.deckSpot.fy, art: { back } });
      if (dealer.used.length) resting.push({ ids: dealer.used, theta: Math.PI, fx: g.usedSpot.fx, fy: g.usedSpot.fy, art: { back, faceOf } });
    }
    // cards lying at a seat / on the board, then everything in the air (lowest first)
    const lying = dealer.held.map((h) => {
      const p = g.place(h.at);
      return { ids: [h.id], theta: h.faceUp ? Math.PI : 0, fx: p.fx, fy: p.fy, scale: p.scale, art: { back, faceOf } };
    }).sort((a, b) => a.fy - b.fy);
    const flying = dealer.flights.map((fl) => {
      const u = (t - fl.t0) / fl.dur, m = mj(u);
      const a = g.place(fl.from), b = g.place(fl.to);
      return {
        ids: fl.ids || [fl.id], theta: fl.flip ? Math.PI * m : fl.faceUp ? Math.PI : 0,
        fx: lerp(a.fx, b.fx, m), fy: lerp(a.fy, b.fy, m),
        baseZ: lerp(a.baseZ, b.baseZ, m) + fl.arc * bump(u),
        scale: lerp(a.scale, b.scale, m),
        art: { back, faceOf }
      };
    }).sort((a, b) => a.baseZ - b.baseZ || a.fy - b.fy);
    const all = [...resting, ...lying, ...flying];
    // opt-in frame log for testing (set window.__bvDeckLog = [] in the console)
    if (window.__bvDeckLog) window.__bvDeckLog.push({
      t: Math.round(t), deck: dealer.deck.length, used: dealer.used.length, routine: !!dealer.routine,
      hidden: [...dealer.hiddenSeats], tableHidden: dealer.tableHidden, own: dealer.ownRevealed,
      board: [dealer.boardShown, dealer.boardFaceUp],
      air: flying.map((f) => [Math.round(f.fx * g.k), Math.round(f.fy * g.k), f.theta ? 1 : 0]),
      lying: lying.length
    });
    if (!back) return;
    for (const s of all) drawStackShadow(ctx, s);     // every shadow on the table first
    for (const s of all) drawStack(ctx, s, s.art);
  }

  onMount(() => {
    let raf = 0, alive = true;
    toImage(renderBack(60, { edge: false })).then((img) => { back = img; });
    const loop = (t) => { if (!alive) return; frame(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  });
</script>

<canvas class="deck-layer" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .deck-layer { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; }
</style>
