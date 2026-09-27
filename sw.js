const CACHE_NAME = "waleedtalal-pwa-v12";

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./styles/site-buttons.css",
  "./scripts/site-ui.js",
  "./scripts/pwa.js",
  "./fonts/cairo-arabic.woff2",
  "./fonts/cairo-latin.woff2",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png",
  "./icons/icon-maskable-512-v2.png",
  "./icons/apple-touch-icon-v2.png",
  "./images/ad.png",
  "./images/aa.jpg",
  "./images/xx.jpg",
  "./pages/us.html",
  "./pages/track.html",
  "./pages/list.html",
  "./pages/hmlat.html",
  "./pages/we.html",
  "./pages/view-us.html",
  "./pages/cases.html",
  "./pages/donate.html",
  "./pages/status.html",
  "./pages/terms.html",
  "./pages/privacy-policy.html",
  "./pages/success.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith("waleedtalal-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await event.preloadResponse || await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        return (
          await caches.match(request, { ignoreSearch: true }) ||
          await caches.match("./offline.html")
        );
      }
    })());
    return;
  }

  const cacheableDestinations = new Set(["style", "script", "image", "font"]);
  if (!cacheableDestinations.has(request.destination) && !url.pathname.endsWith(".json")) {
    return;
  }

  // الشبكة أولاً لظهور التحديثات فوراً، والكاش بديل عند انقطاع الاتصال.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return caches.match(request, { ignoreSearch: true });
    }
  })());
});
