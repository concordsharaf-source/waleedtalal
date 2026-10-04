import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getMessaging,
    getToken,
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
    return getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration
    });
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
