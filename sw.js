const CACHE_NAME = "waleedtalal-pwa-v32";

/* Firebase Cloud Messaging لإظهار رسائل المحادثة عند إغلاق التطبيق. */
let firebaseMessaging = null;
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
  firebase.initializeApp({
    apiKey: "AIzaSyDD_I84b3b6bmVkjVx-t2g7Cbd6RPcYz_Q",
    authDomain: "sparepartswebsite1.firebaseapp.com",
    projectId: "sparepartswebsite1",
    storageBucket: "sparepartswebsite1.firebasestorage.app",
    messagingSenderId: "1063114847735",
    appId: "1:1063114847735:web:0e764c150ab10df2d82af2"
  });
  firebaseMessaging = firebase.messaging();
  firebaseMessaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const title = data.title || "رسالة جديدة من مؤسسة الوليد";
    return self.registration.showNotification(title, {
      body: data.body || "لديك رسالة جديدة في المحادثة.",
      icon: "/icons/chat-app-192.png",
      badge: "/icons/chat-app-192.png",
      dir: "rtl",
      lang: "ar",
      tag: data.orderId ? `chat-${data.orderId}` : "waleed-chat",
      renotify: true,
      data: {
        url: data.url || "/pages/chat.html",
        orderId: data.orderId || "",
        messageId: data.messageId || ""
      },
      actions: [
        { action: "open-chat", title: "فتح المحادثة" }
      ]
    });
  });
} catch (error) {
  console.error("تعذر تهيئة إشعارات Firebase", error);
}

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./chat-manifest.json",
  "./admin-chat-manifest.json",
  "./styles/site-buttons.css",
  "./styles/chat.css",
  "./scripts/site-ui.js",
  "./scripts/pwa.js",
  "./scripts/chat-core.js",
  "./scripts/chat-audio.js",
  "./scripts/chat-media.js",
  "./scripts/chat-beneficiary.js",
  "./scripts/chat-admin.js",
  "./scripts/push-notifications.js",
  "./fonts/cairo-arabic.woff2",
  "./fonts/cairo-latin.woff2",
  "./fonts/noto-naskh-arabic-400.ttf",
  "./fonts/noto-naskh-arabic-700.ttf",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png",
  "./icons/icon-maskable-512-v2.png",
  "./icons/apple-touch-icon-v2.png",
  "./icons/whatsapp.svg",
  "./icons/chat-app-192.png",
  "./icons/chat-app-512.png",
  "./images/ad.png",
  "./images/aa.jpg",
  "./images/xx.jpg",
  "./pages/us.html",
  "./pages/track.html",
  "./pages/chat.html",
  "./pages/admin-chat.html",
  "./pages/list.html",
  "./pages/hmlat.html",
  "./pages/we.html",
  "./pages/view-us.html",
  "./pages/cases.html",
  "./pages/donate.html",
  "./pages/status.html",
  "./pages/terms.html",
  "./pages/privacy-policy.html",
  "./pages/success.html",
  "./pages/orders-view.html"
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

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/pages/chat.html", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("navigate" in client) await client.navigate(targetUrl);
      if ("focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
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
