// Client-side loader for the existing Replay Poker card renderer
// (static/replay-engine/cards.js), the same deck the Data-page replay
// uses. It's a classic script that hangs off `window.CasinoCards`; we
// inject it once and share the load promise across every <Card>.
//
// SSR-safe: returns null on the server (no window).

let _promise = null;

export function loadCards() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.CasinoCards) return Promise.resolve(window.CasinoCards);
  if (_promise) return _promise;

  _promise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-casino-cards]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.CasinoCards));
      existing.addEventListener("error", reject);
      if (window.CasinoCards) resolve(window.CasinoCards);
      return;
    }
    const s = document.createElement("script");
    s.src = "/replay-engine/cards.js";
    s.async = true;
    s.dataset.casinoCards = "1";
    s.onload = () => resolve(window.CasinoCards);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _promise;
}
