// Svelte action: a sliding selector indicator.
//
// Attach to a container that holds a set of choice elements. The action injects
// a `.sel-ind` box (styled in app.css) and animates it under whichever child is
// currently active — matched by `.on` or `aria-current="page"` by default. It
// repositions on resize, on font load, and whenever a child's class/aria-current
// changes (so it follows navigation without any manual wiring).
//
//   <nav class="nav-tabs" use:slidingIndicator>
//     <a class="nav-tab" aria-current="page">Lobby</a> …
//   </nav>
export function slidingIndicator(node, options = {}) {
  const activeSel = options.activeSel || '.on, [aria-current="page"]';

  let ind = node.querySelector(":scope > .sel-ind");
  if (!ind) {
    ind = document.createElement("span");
    ind.className = "sel-ind";
    node.prepend(ind);
  }

  // The nearest horizontally-scrolling ancestor (the strip's viewport), if any.
  function scroller() {
    let el = node;
    while (el && el !== document.body) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) return el;
      el = el.parentElement;
    }
    return null;
  }

  let lastActive = null;
  function move() {
    const active = node.querySelector(activeSel);
    if (!active || active === ind) {
      ind.style.opacity = "0";
      return;
    }
    ind.style.opacity = "1";
    ind.style.width = active.offsetWidth + "px";
    ind.style.height = active.offsetHeight + "px";
    ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    // Keep the active choice visible inside a scrolling strip.
    if (active !== lastActive) {
      lastActive = active;
      const sc = scroller();
      if (sc) {
        const left = active.offsetLeft - (sc.clientWidth - active.offsetWidth) / 2;
        sc.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      }
    }
  }

  // Mouse wheel over a horizontal strip scrolls it sideways (a vertical wheel
  // otherwise does nothing useful there). Only intercept when the strip can
  // actually move in that direction, so the page keeps scrolling at the ends.
  function onWheel(e) {
    const sc = scroller();
    if (!sc) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    const max = sc.scrollWidth - sc.clientWidth;
    const can = delta > 0 ? sc.scrollLeft < max - 1 : sc.scrollLeft > 1;
    if (!can) return;
    e.preventDefault();
    sc.scrollLeft += delta;
  }
  node.addEventListener("wheel", onWheel, { passive: false });

  const ro = new ResizeObserver(move);
  ro.observe(node);

  const mo = new MutationObserver(move);
  mo.observe(node, { attributes: true, subtree: true, attributeFilter: ["aria-current", "class"] });

  const onResize = () => move();
  window.addEventListener("resize", onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(move);
  requestAnimationFrame(move);
  // a second pass after layout settles (scrollable rows, late fonts)
  setTimeout(move, 60);

  return {
    update: move,
    destroy() {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", onResize);
      node.removeEventListener("wheel", onWheel);
    },
  };
}
