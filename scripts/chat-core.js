import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    doc,
    onSnapshot,
    runTransaction,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDD_I84b3b6bmVkjVx-t2g7Cbd6RPcYz_Q",
    authDomain: "sparepartswebsite1.firebaseapp.com",
    projectId: "sparepartswebsite1",
    storageBucket: "sparepartswebsite1.firebasestorage.app",
    messagingSenderId: "1063114847735",
    appId: "1:1063114847735:web:0e764c150ab10df2d82af2"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const ADMIN_ACTOR = "admin";
export const CLIENT_ACTOR = "client";
export const MAX_CHAT_MESSAGES = 100;

export function normalizeDigits(value) {
    return String(value ?? "")
        .replace(/[٠-٩]/g, digit => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
        .replace(/[۰-۹]/g, digit => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
}

export function normalizePhone(value) {
    const phone = normalizeDigits(value).replace(/[^0-9]/g, "");
    return phone.startsWith("00") ? phone.slice(2) : phone;
}

export function normalizeTransaction(value) {
    return normalizeDigits(value).replace(/[^0-9]/g, "");
}

export function createMessageId() {
    return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 80);
}

export function formatMessageTime(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ar-SA", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

export function formatMessageDate(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "اليوم";
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "أمس";
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(date);
}

export function sortMessages(messages) {
    return [...(Array.isArray(messages) ? messages : [])]
        .sort((a, b) => new Date(a.clientTime || 0) - new Date(b.clientTime || 0));
}

function formatOrderTimestamp(value) {
    if (!value) return "غير متاح";
    const date = typeof value.toDate === "function"
        ? value.toDate()
        : value.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
    if (Number.isNaN(date.getTime())) return "غير متاح";
    return date.toLocaleString("ar-SA-u-ca-gregory", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function buildWelcomeMessage(order) {
    const transactionId = String(order.transactionId || "—");
    const details = [
        `📋 تفاصيل الطلب المقدم (#${transactionId})`,
        `👤 المستفيد: ${order.name || "غير محدد"}`,
        `🆔 رقم الهوية: ${order.idNumber || "غير محدد"}`,
        `🌍 الدولة: ${order.country || "غير محدد"}`,
        `📞 رقم الهاتف: ${order.phone || "غير محدد"}`,
        `✉️ البريد الإلكتروني: ${order.email || "غير محدد"}`,
        `🏦 اسم البنك: ${order.bankName || "غير محدد"}`,
        `💳 رقم الحساب/الآيبان: ${order.partNumber || "غير محدد"}`,
        `📂 نوع الطلب: ${order.type || "غير محدد"}`,
        `📝 شرح الاحتياج: ${order.notes || "غير محدد"}`,
        `📍 حالة الطلب: ${order.status || "قيد المراجعة"}`,
        `✅ حالة الاعتماد: ${order.approved === true ? "معتمد" : "غير معتمد"}`,
        `💰 مبلغ المنحة: ${order.grantAmount || "غير محدد"}`,
        `🗓️ تاريخ تقديم الطلب: ${formatOrderTimestamp(order.createdAt)}`,
        "",
        "مرحباً بك عزيزي المستفيد، تم استلام طلبك بنجاح. يمكنك التواصل المباشر مع إدارة المؤسسة هنا لمتابعة تفاصيل وإجراءات طلبك."
    ];

    return {
        id: createMessageId(),
        senderId: ADMIN_ACTOR,
        senderName: "إدارة المؤسسة",
        text: details.join("\n"),
        clientTime: new Date().toISOString(),
        messageType: "text",
        replyTo: null,
        readBy: [],
        deletedFor: [],
        deletedForAll: false,
        starredBy: []
    };
}

export async function findOrderByCredentials(transactionId, phone) {
    const cleanTransaction = normalizeTransaction(transactionId);
    const cleanPhone = normalizePhone(phone);
    if (!cleanTransaction || !cleanPhone) return null;

    const snapshot = await getDocs(query(
        collection(db, "orders"),
        where("transactionId", "==", cleanTransaction)
    ));

    for (const orderDocument of snapshot.docs) {
        const data = orderDocument.data();
        if (normalizePhone(data.phone) === cleanPhone) {
            return { id: orderDocument.id, data };
        }
    }

    return null;
}

export async function ensureChatInitialized(orderId) {
    const orderRef = doc(db, "orders", orderId);
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("order-not-found");
        const order = snapshot.data();
        if (Array.isArray(order.chatMessages) && order.chatMessages.length) return;
        const welcome = buildWelcomeMessage(order);
        transaction.update(orderRef, {
            chatEnabled: true,
            chatMessages: [welcome],
            chatLastMessage: welcome.text,
            chatLastSender: ADMIN_ACTOR,
            chatUpdatedAt: serverTimestamp(),
            "chatOnline.admin": false,
            "chatOnline.client": false,
            "chatTyping.admin": false,
            "chatTyping.client": false
        });
    });
}

export function subscribeToOrder(orderId, onData, onError = console.error) {
    return onSnapshot(doc(db, "orders", orderId), snapshot => {
        if (!snapshot.exists()) {
            onError(new Error("order-not-found"));
            return;
        }
        onData({ id: snapshot.id, ...snapshot.data() });
    }, onError);
}

export async function sendChatMessage(orderId, actor, text, replyTo = null) {
    const cleanText = String(text || "").trim().slice(0, 2500);
    if (!cleanText) return null;

    const orderRef = doc(db, "orders", orderId);
    const message = {
        id: createMessageId(),
        senderId: actor,
        senderName: actor === ADMIN_ACTOR ? "إدارة المؤسسة" : "المستفيد",
        text: cleanText,
        clientTime: new Date().toISOString(),
        messageType: "text",
        replyTo: replyTo ? {
            id: String(replyTo.id || ""),
            senderName: String(replyTo.senderName || ""),
            text: String(replyTo.text || "").slice(0, 180)
        } : null,
        readBy: [actor],
        deletedFor: [],
        deletedForAll: false,
        starredBy: []
    };

    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("order-not-found");
        const order = snapshot.data();
        const current = Array.isArray(order.chatMessages) ? order.chatMessages : [];
        const next = [...current.slice(-(MAX_CHAT_MESSAGES - 1)), message];
        transaction.update(orderRef, {
            chatEnabled: true,
            chatMessages: next,
            chatLastMessage: cleanText,
            chatLastSender: actor,
            chatUpdatedAt: serverTimestamp(),
            [`chatTyping.${actor}`]: false
        });
    });

    return message;
}

export async function createPendingAudioMessage(orderId, actor, duration, mimeType, replyTo = null) {
    const safeDuration = Math.max(1, Math.min(180, Math.round(Number(duration) || 1)));
    const orderRef = doc(db, "orders", orderId);
    const message = {
        id: createMessageId(),
        senderId: actor,
        senderName: actor === ADMIN_ACTOR ? "إدارة المؤسسة" : "المستفيد",
        text: "🎤 جارٍ رفع الرسالة الصوتية...",
        clientTime: new Date().toISOString(),
        messageType: "audio",
        audioUrl: "",
        audioDuration: safeDuration,
        audioMime: String(mimeType || "audio/webm").slice(0, 80),
        uploadStatus: "pending",
        replyTo: replyTo ? {
            id: String(replyTo.id || ""),
            senderName: String(replyTo.senderName || ""),
            text: String(replyTo.text || "").slice(0, 180)
        } : null,
        readBy: [actor],
        deletedFor: [],
        deletedForAll: false,
        starredBy: []
    };

    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("order-not-found");
        const order = snapshot.data();
        const current = Array.isArray(order.chatMessages) ? order.chatMessages : [];
        const next = [...current.slice(-(MAX_CHAT_MESSAGES - 1)), message];
        transaction.update(orderRef, {
            chatEnabled: true,
            chatMessages: next,
            chatLastMessage: "🎤 رسالة صوتية",
            chatLastSender: actor,
            chatUpdatedAt: serverTimestamp(),
            [`chatTyping.${actor}`]: false
        });
    });

    return message;
}

export async function markChatAudioFailed(orderId, messageId) {
    await mutateMessage(orderId, messageId, message => {
        if (message.messageType !== "audio" || message.uploadStatus !== "pending") return message;
        return {
            ...message,
            text: "تعذر إرسال الرسالة الصوتية",
            uploadStatus: "failed"
        };
    });
}

export async function markMessagesRead(orderId, actor) {
    const orderRef = doc(db, "orders", orderId);
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) return;
        const order = snapshot.data();
        const current = Array.isArray(order.chatMessages) ? order.chatMessages : [];
        let changed = false;
        const next = current.map(message => {
            if (message.senderId === actor || message.deletedForAll) return message;
            const readBy = Array.isArray(message.readBy) ? message.readBy : [];
            if (readBy.includes(actor)) return message;
            changed = true;
            return { ...message, readBy: [...readBy, actor] };
        });
        if (changed) transaction.update(orderRef, { chatMessages: next });
    });
}

export async function toggleMessageStar(orderId, messageId, actor) {
    await mutateMessage(orderId, messageId, message => {
        const starredBy = Array.isArray(message.starredBy) ? message.starredBy : [];
        const next = starredBy.includes(actor)
            ? starredBy.filter(item => item !== actor)
            : [...starredBy, actor];
        return { ...message, starredBy: next };
    });
}

export async function deleteMessageForMe(orderId, messageId, actor) {
    await mutateMessage(orderId, messageId, message => {
        const deletedFor = Array.isArray(message.deletedFor) ? message.deletedFor : [];
        if (deletedFor.includes(actor)) return message;
        return { ...message, deletedFor: [...deletedFor, actor] };
    });
}

export async function deleteMessageForEveryone(orderId, messageId, actor) {
    await mutateMessage(orderId, messageId, message => {
        if (message.senderId !== actor) return message;
        return {
            ...message,
            text: "تم حذف هذه الرسالة",
            replyTo: null,
            deletedForAll: true
        };
    });
}

async function mutateMessage(orderId, messageId, transform) {
    const orderRef = doc(db, "orders", orderId);
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("order-not-found");
        const order = snapshot.data();
        const current = Array.isArray(order.chatMessages) ? order.chatMessages : [];
        let changed = false;
        const next = current.map(message => {
            if (message.id !== messageId) return message;
            changed = true;
            return transform(message);
        });
        if (changed) transaction.update(orderRef, {
            chatMessages: next,
            chatUpdatedAt: serverTimestamp()
        });
    });
}

function getPushDeviceId() {
    const key = "waleed_chat_push_device_id";
    let value = localStorage.getItem(key);
    if (!value) {
        value = createMessageId();
        localStorage.setItem(key, value);
    }
    return value;
}

export async function registerChatPushToken(orderId, actor, token) {
    if (!orderId || ![ADMIN_ACTOR, CLIENT_ACTOR].includes(actor) || !token) return false;
    const orderRef = doc(db, "orders", orderId);
    const deviceId = getPushDeviceId();

    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("order-not-found");
        const order = snapshot.data();
        const existing = Array.isArray(order.chatPushTokens?.[actor])
            ? order.chatPushTokens[actor]
            : [];
        const normalized = existing
            .map(item => typeof item === "string" ? { token: item } : item)
            .filter(item => item && item.token && item.token !== token && item.deviceId !== deviceId)
            .slice(-4);
        normalized.push({
            token: String(token).slice(0, 500),
            deviceId,
            updatedAt: new Date().toISOString()
        });
        transaction.update(orderRef, {
            [`chatPushTokens.${actor}`]: normalized
        });
    });
    return true;
}

export async function setChatPresence(orderId, actor, online) {
    if (!orderId) return;
    const changes = {
        [`chatOnline.${actor}`]: Boolean(online)
    };
    if (!online) {
        changes[`chatTyping.${actor}`] = false;
        changes[`chatLastSeen.${actor}`] = serverTimestamp();
    }
    try {
        await updateDoc(doc(db, "orders", orderId), changes);
    } catch (error) {
        console.warn("Presence update failed", error);
    }
}

export async function setChatTyping(orderId, actor, typing) {
    if (!orderId) return;
    try {
        await updateDoc(doc(db, "orders", orderId), {
            [`chatTyping.${actor}`]: Boolean(typing)
        });
    } catch (error) {
        console.warn("Typing update failed", error);
    }
}

export function otherActor(actor) {
    return actor === ADMIN_ACTOR ? CLIENT_ACTOR : ADMIN_ACTOR;
}

export function actorDisplayName(actor) {
    return actor === ADMIN_ACTOR ? "إدارة المؤسسة" : "المستفيد";
}
