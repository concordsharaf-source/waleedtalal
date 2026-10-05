import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyDD_I84b3b6bmVkjVx-t2g7Cbd6RPcYz_Q",
    authDomain: "sparepartswebsite1.firebaseapp.com",
    projectId: "sparepartswebsite1",
    storageBucket: "sparepartswebsite1.firebasestorage.app",
    messagingSenderId: "1063114847735",
    appId: "1:1063114847735:web:0e764c150ab10df2d82af2"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let cachedVapidKey = "";
let foregroundListenerStarted = false;

function ensureForegroundListener(messaging) {
    if (foregroundListenerStarted) return;
    foregroundListenerStarted = true;
    onMessage(messaging, payload => {
        const data = payload.data || {};
        window.dispatchEvent(new CustomEvent("waleed-chat-push", { detail: data }));
        if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
        navigator.serviceWorker.ready.then(registration => registration.showNotification(
            payload.notification?.title || data.title || "رسالة جديدة من مؤسسة الوليد",
            {
                body: payload.notification?.body || data.body || "لديك رسالة جديدة في المحادثة.",
                icon: "/icons/chat-app-192.png",
                badge: "/icons/chat-app-192.png",
                dir: "rtl",
                lang: "ar",
                tag: data.orderId
                    ? `chat-${data.orderId}-${data.notificationId || data.messageId || Date.now()}`
                    : `waleed-chat-${data.notificationId || data.messageId || Date.now()}`,
                renotify: true,
                silent: false,
                vibrate: [180, 90, 180],
                timestamp: Date.now(),
                data: {
                    url: data.url || "/pages/chat.html",
                    orderId: data.orderId || "",
                    messageId: data.messageId || "",
                    notificationId: data.notificationId || ""
                }
            }
        )).catch(error => console.warn("Foreground notification failed", error));
    });
}

async function loadVapidKey() {
    if (cachedVapidKey) return cachedVapidKey;
    const response = await fetch("/api/push-config", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
    });
    if (!response.ok) throw new Error("push-config-unavailable");
    const config = await response.json();
    if (!config.configured || !config.vapidKey) throw new Error("push-config-unavailable");
    cachedVapidKey = String(config.vapidKey);
    return cachedVapidKey;
}

export async function getBrowserPushToken({ requestPermission = false } = {}) {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;

    // اطلب الإذن مباشرة داخل نقرة المستخدم قبل أي await آخر حتى لا تضيع user activation.
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) {
        permission = await Notification.requestPermission();
    }
    if (permission !== "granted" || !(await isSupported())) return null;

    const [vapidKey, registration] = await Promise.all([
        loadVapidKey(),
        navigator.serviceWorker.ready
    ]);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration
    });
    ensureForegroundListener(messaging);
    return token;
}

export async function sendPushForMessage({ orderId, senderId, messageId }) {
    if (!orderId || !senderId || !messageId) return null;
    const response = await fetch("/api/send-chat-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId, senderId, messageId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "push-send-failed");
    return result;
}
