// sw.js (Logi)
// Nota: mantén CACHE_VERSION cambiándolo en cada deploy.
const CACHE_VERSION = "logi2-v20260503-SUPA";
const CACHE = `logi2-cache-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./script.js",
  "./inline.js",
  "./main_inline.js",
  "./supabase-pwa-bridge.js",
  "./manifest.webmanifest?v=0.1.43",
  "./favicon.v0.8.7.33.7.png",
  "./apple-touch-icon.v0.8.7.33.7.png",
  "./icon-192.png",
  "./icon-192.v0.8.7.33.7.png",
  "./icon-512.v0.8.7.33.7.png",
  "./icon-192-maskable.v0.8.7.33.7.png",
  "./icon-512-maskable.v0.8.7.33.7.png",
  "./lib/docx.min.js",
  "./lib/jszip.min.js",
  "./lib/pdf-lib.min.js",
  "./lib/xlsx.full.min.js",
  "./templates/templates.json",
  "./templates/classic.stub.txt",
  "./templates/tags-tabla.stub.txt",
];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Cachear uno por uno: si alguno falla (404), NO rompe el install.
    for (const url of ASSETS) {
      try {
        const req = new Request(url, { cache: "reload" });
        const res = await fetch(req);
        if (res && res.ok) await cache.put(req, res);
      } catch (err) {
        // Silencioso: el objetivo es que el SW no quede "roto" por un archivo faltante.
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("logi2-cache-") && k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === "navigate";

  // Navegación: network-first
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
        const cached = await cache.match(req);
        return (
          cached ||
          (await cache.match("./index.html")) ||
          (await cache.match("./")) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // Assets: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === "opaque")) {
        await cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
