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
  }

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
    },
  };
}
