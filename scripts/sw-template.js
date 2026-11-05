// Service worker template. The build replaces the two placeholders (see vite.config.ts).
// Strategy: precache the whole build, serve from cache first, fall back to the network.
// A new version waits until the page asks it to take over, so an open editor never has
// its hashed files swapped out from under it.
const VERSION = "__VERSION__";
const CACHE = `rippleflow-${VERSION}`;
const FILES = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("rippleflow-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only our own GETs. Range requests (media seeking) must reach the network: a cached 200 would break them.
  if (req.method !== "GET" || url.origin !== location.origin || req.headers.has("range")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === "navigate") {
          const shell = await cache.match(new URL("index.html", self.registration.scope).href);
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
