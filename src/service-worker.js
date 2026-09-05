/// <reference types="@sveltejs/kit" />
// Bluffing Valley service worker — makes the site installable (PWA) and keeps the
// shell + immutable build assets available offline. Strategy:
//   * build assets + app icons + manifest + offline page: precached at
//     install, cache-first (build names are content-hashed; a deploy changes
//     `version`, hence the cache name, so stale caches are dropped on activate).
//   * other same-origin static files (deck parts, replay engine…): runtime
//     stale-while-revalidate — served from cache once seen, refreshed behind.
//   * navigations (HTML): network-first. If the network is slow we only fall
//     back early when a cached copy of that page exists; otherwise we keep
//     waiting, and show the offline page only when the fetch actually fails.
//   * NEVER cached: /api/*, /ws, /replay/*, /media/*, anything non-GET — game
//     state, wallets and replays are always live.
import { build, files, version } from "$service-worker";

const CACHE = `bluffing-valley-${version}`;
const SHELL_STATIC = files.filter((f) =>
  f.startsWith("/icons/") || f.startsWith("/favicon") || f === "/brand.svg" || f === "/manifest.webmanifest" || f === "/offline.html"
);
const PRECACHE = [...build, ...SHELL_STATIC];
const PRECACHE_SET = new Set(PRECACHE);
const OFFLINE_URL = "/offline.html";
const NEVER_CACHE = [/^\/api\//, /^\/ws(\/|$)/, /^\/replay\//, /^\/media\//, /^\/casino-data\//];
const RUNTIME_STATIC = [/^\/deck-parts\//, /^\/replay-engine\//];
const NAV_SLOW_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })
  );
});

async function navigate(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((res) => {
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) cache.put(request, res.clone());
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(() => resolve("slow"), NAV_SLOW_MS));
  try {
    const first = await Promise.race([network, slow]);
    if (first !== "slow") return first;
    const cached = await cache.match(request);
    if (cached) return cached;          // slow network, but we have this page
    return await network;               // nothing cached: keep waiting for the server
  } catch {
    return (await cache.match(request)) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // fonts etc. — browser cache handles them
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  } else if (request.mode === "navigate") {
    event.respondWith(navigate(request));
  } else if (RUNTIME_STATIC.some((re) => re.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
