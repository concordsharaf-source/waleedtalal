const CACHE_NAME = "waleedtalal-pwa-v45";

/*
 * نستقبل Web Push مباشرة بلا importScripts خارجي. الاعتماد السابق على مكتبة
 * Firebase داخل عامل الخدمة كان نقطة الفشل المشتركة على الأجهزة: يقبل FCM
 * الرسالة، لكن تعطل تحميل المكتبة يمنع عرضها. المستمع الخام يعمل حتى عند
 * إغلاق التطبيق ويعرض كل رسالة من بيانات FCM بنفسه.
 */
function showIncomingPush(payload = {}) {
  const data = payload.data || payload || {};
  if (data.type && data.type !== "chat-message") return Promise.resolve();
  const notification = payload.notification || {};
  const title = data.title || notification.title || "رسالة جديدة من مؤسسة الوليد";
  const notificationId = data.notificationId || data.messageId || Date.now();
  return self.registration.showNotification(title, {
    body: data.body || notification.body || "لديك رسالة جديدة في المحادثة.",
    icon: "/icons/chat-app-192.png",
    badge: "/icons/chat-app-192.png",
    dir: "rtl",
    lang: "ar",
    tag: data.orderId ? `chat-${data.orderId}-${notificationId}` : `waleed-chat-${notificationId}`,
    renotify: true,
    silent: false,
    vibrate: [180, 90, 180],
    timestamp: Date.now(),
    data: {
      url: data.url || "/pages/chat.html",
      orderId: data.orderId || "",
      messageId: data.messageId || "",
      notificationId: String(notificationId)
    },
    actions: [
      { action: "open-chat", title: "فتح المحادثة" }
    ]
  });
}

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { data: { body: event.data ? event.data.text() : "" } };
  }
  event.waitUntil(showIncomingPush(payload));
});

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
  "./icons/admin-chat-192.png",
  "./icons/admin-chat-512.png",
  "./icons/admin-chat-maskable-512.png",
  "./images/ad.png",
  "./images/chat-foundation-avatar.jpg",
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
    const target = new URL(targetUrl);
    for (const client of windows) {
      const current = new URL(client.url);
      // لا ننقل تطبيق المستفيد أو الموقع العام إلى واجهة الإدارة؛ نعيد استخدام
      // نافذة التطبيق المطابقة فقط، وإلا نفتح تطبيق/نافذة الإدارة مستقلة.
      if (current.pathname !== target.pathname) continue;
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
