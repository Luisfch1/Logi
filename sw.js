// sw.js
const CACHE_VERSION = "v0.4";
const CACHE = `logi-cache-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",

  "./favicon.png",
  "./apple-touch-icon.png",

  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("logi-cache-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === "navigate";

  // NAV: network-first
  if (isNav) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh && fresh.ok) {
          await cache.put(req, fresh.clone());
          return fresh;
        }
        throw new Error("bad response");
      } catch {
        const cached = await cache.match(req, { ignoreSearch: true });
        return cached || cache.match("./index.html") || cache.match("./") || Response.error();
      }
    })());
    return;
  }

  // ASSETS: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
