const CACHE_PREFIX = "homebank-web-mvp-";
const CACHE_NAME = `${CACHE_PREFIX}v16`;
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.headers.has("Authorization")) return;
  if (event.request.mode !== "navigate" && !["script", "style", "image", "font", "manifest"].includes(event.request.destination)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached && event.request.mode !== "navigate") return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === "basic") await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const fallback = cached ?? (event.request.mode === "navigate" ? await cache.match("/index.html") : undefined);
        if (fallback) return fallback;
        throw error;
      }
    })(),
  );
});
