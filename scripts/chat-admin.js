import { collection, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    db,
    ADMIN_ACTOR,
    CLIENT_ACTOR,
    createMessageId,
    sortMessages,
    formatMessageTime,
    formatMessageDate,
    sendChatMessage,
    createPendingAudioMessage,
    markChatAudioFailed,
    createPendingMediaMessage,
    markChatMediaFailed,
    markMessagesDelivered,
    markMessagesRead,
    toggleMessageStar,
    setMessagesStarred,
    togglePinnedMessage,
    toggleConversationPin,
    deleteMessageForMe,
    deleteMessagesForMe,
    deleteMessageForEveryone,
    deleteMessagesForEveryone,
    clearConversationMessages,
    registerChatPushToken,
    unregisterChatPushToken,
    setChatPresence,
    setChatTyping,
    normalizeDigits
} from "./chat-core.js";
import {
    getBrowserPushToken,
    sendPushForMessage
} from "./push-notifications.js";
import {
    createVoiceRecorder,
    uploadChatAudio,
    createAudioMessagePlayer
} from "./chat-audio.js";
import {
    uploadChatMedia,
    createMediaMessageContent,
    primeLocalMediaPreview,
    releaseLocalMediaPreview
} from "./chat-media.js";

const ADMIN_PASSWORD = "232167";
const ADMIN_INSTALL_KEY = "waleed_admin_chat_app_installed";
const ADMIN_NOTIFICATIONS_DISABLED_KEY = "waleed_chat_admin_notifications_disabled";
const EMOJIS = ["😀","😊","😂","😍","🥰","😄","😢","😭","😮","😔","👍","👎","👏","🙏","🤲","❤️","💚","💙","✨","🎉","✅","📌","📄","📞","🏦","🇸🇦","🌹","💬","🤝","🌟","💯"];

const adminLock = document.getElementById("adminLock");
const adminChatApp = document.getElementById("adminChatApp");
const loginForm = document.getElementById("adminLoginForm");
const adminPassword = document.getElementById("adminPassword");
const loginError = document.getElementById("adminLoginError");
const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const conversationCount = document.getElementById("conversationCount");
const adminNotificationButton = document.getElementById("adminNotificationButton");
const adminConversation = document.getElementById("adminConversation");
const adminEmpty = document.getElementById("adminEmpty");
const adminChatTop = document.getElementById("adminChatTop");
const adminMessagesArea = document.getElementById("adminMessagesArea");
const adminMessagesList = document.getElementById("adminMessagesList");
const adminComposerZone = document.getElementById("adminComposerZone");
const clientName = document.getElementById("clientName");
const clientAvatar = document.getElementById("clientAvatar");
const clientStatus = document.getElementById("clientStatus");
const clientWhatsapp = document.getElementById("clientWhatsapp");
const adminOrderBadge = document.getElementById("adminOrderBadge");
const adminMessageSearchBar = document.getElementById("adminMessageSearchBar");
const adminMessageSearchInput = document.getElementById("adminMessageSearchInput");
const adminMessageSearchCount = document.getElementById("adminMessageSearchCount");
const adminStarredMessagesButton = document.getElementById("adminStarredMessagesButton");
const adminTypingBar = document.getElementById("adminTypingBar");
const messageForm = document.getElementById("adminMessageForm");
const messageInput = document.getElementById("adminMessageInput");
const sendButton = document.getElementById("adminSendButton");
const composerActionIcon = document.getElementById("adminComposerActionIcon");
const voiceRecorderPanel = document.getElementById("adminVoiceRecorder");
const voiceRecordingTimer = document.getElementById("adminVoiceRecordingTimer");
const cancelVoiceRecording = document.getElementById("adminCancelVoiceRecording");
const pauseVoiceRecording = document.getElementById("adminPauseVoiceRecording");
const sendVoiceRecording = document.getElementById("adminSendVoiceRecording");
const cameraButton = document.getElementById("adminCameraButton");
const mediaInput = document.getElementById("adminChatMediaInput");
const cameraInput = document.getElementById("adminChatCameraInput");
const attachmentSheet = document.getElementById("adminAttachmentSheet");
const emojiPanel = document.getElementById("adminEmojiPanel");
const replyPreview = document.getElementById("adminReplyPreview");
const replySender = document.getElementById("adminReplySender");
const replyText = document.getElementById("adminReplyText");
const messageMenu = document.getElementById("adminMessageMenu");
const infoModal = document.getElementById("adminMessageInfoModal");
const infoBody = document.getElementById("adminMessageInfoBody");
const selectionBar = document.getElementById("adminSelectionBar");
const selectionCount = document.getElementById("adminSelectionCount");
const selectionStar = document.getElementById("adminSelectionStar");
const selectionPin = document.getElementById("adminSelectionPin");
const selectionDeleteAll = document.getElementById("adminSelectionDeleteAll");
const pinnedMessageBar = document.getElementById("adminPinnedMessage");
const pinnedMessageSender = document.getElementById("adminPinnedMessageSender");
const pinnedMessageText = document.getElementById("adminPinnedMessageText");
const confirmModal = document.getElementById("adminConfirmModal");
const confirmTitle = document.getElementById("adminConfirmTitle");
const confirmMessage = document.getElementById("adminConfirmMessage");
const confirmAccept = document.getElementById("adminAcceptConfirm");
const toast = document.getElementById("adminToast");
const installAdminChatAppButton = document.getElementById("installAdminChatAppButton");

let allConversations = [];
let currentOrder = null;
let unsubscribeOrders = null;
let replyTarget = null;
let activeMessage = null;
let messageMenuOpenedAt = 0;
let selectionMode = false;
const selectedMessageIds = new Set();
let confirmationResolver = null;
let initialSnapshotLoaded = false;
let knownClientMessageIds = new Set();
let toastTimer = null;
let typingTimer = null;
let longPressTimer = null;
let longPressOrigin = { x: 0, y: 0 };
let messageAckRunning = false;
let messageAckPending = false;
let messageSearchQuery = "";
let starredOnly = false;
let adminPushToken = "";
let adminNotificationToggleBusy = false;
const optimisticMessages = new Map();
const deliveryAckOrders = new Set();
let adminTokenRegistrationRunning = false;
let notificationOrderHandled = false;
let deferredAdminInstallPrompt = null;
let voiceRecorder = null;
let renderedMessagesSignature = "";

function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function isAdminAppContext() {
    return window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true ||
        new URLSearchParams(location.search).get("source") === "admin-chat-pwa";
}

function markAdminAppInstalled() {
    localStorage.setItem(ADMIN_INSTALL_KEY, "yes");
    deferredAdminInstallPrompt = null;
    installAdminChatAppButton.hidden = true;
}

function orderHasPushToken(order, token) {
    const records = Array.isArray(order.chatPushTokens?.admin) ? order.chatPushTokens.admin : [];
    return records.some(item => (typeof item === "string" ? item : item?.token) === token);
}

function adminNotificationsOptedOut() {
    return localStorage.getItem(ADMIN_NOTIFICATIONS_DISABLED_KEY) === "yes";
}

function adminNotificationsEnabled() {
    return Boolean(adminPushToken) && !adminNotificationsOptedOut() &&
        "Notification" in window && Notification.permission === "granted";
}

function renderAdminNotificationButton() {
    const enabled = adminNotificationsEnabled();
    adminNotificationButton.classList.toggle("is-enabled", enabled);
    adminNotificationButton.classList.toggle("needs-attention", !enabled);
    adminNotificationButton.setAttribute("aria-pressed", String(enabled));
    adminNotificationButton.setAttribute("aria-label", enabled ? "تعطيل إشعارات الإدارة على هذا الجهاز" : "تفعيل إشعارات الإدارة على هذا الجهاز");
    adminNotificationButton.title = enabled
        ? "الإشعارات مفعلة على هذا الجهاز — اضغط لتعطيلها"
        : "الإشعارات معطلة على هذا الجهاز — اضغط لتفعيلها";
    adminNotificationButton.disabled = adminNotificationToggleBusy;
}

async function registerAdminTokenForConversations(token) {
    if (!token || adminTokenRegistrationRunning || adminNotificationsOptedOut()) return;
    adminTokenRegistrationRunning = true;
    try {
        const pending = allConversations.filter(order => !orderHasPushToken(order, token));
        for (let index = 0; index < pending.length; index += 5) {
            if (adminNotificationsOptedOut()) break;
            const group = pending.slice(index, index + 5);
            await Promise.allSettled(group.map(order =>
                registerChatPushToken(order.id, ADMIN_ACTOR, token)
            ));
            if (adminNotificationsOptedOut()) {
                await Promise.allSettled(group.map(order =>
                    unregisterChatPushToken(order.id, ADMIN_ACTOR, token)
                ));
                break;
            }
        }
    } finally {
        adminTokenRegistrationRunning = false;
    }
}

async function unregisterAdminTokenFromAllOrders(token) {
    const snapshot = await getDocs(collection(db, "orders"));
    const targets = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(order => Array.isArray(order.chatPushTokens?.[ADMIN_ACTOR]) &&
            order.chatPushTokens[ADMIN_ACTOR].length > 0);
    for (let index = 0; index < targets.length; index += 5) {
        const results = await Promise.allSettled(targets.slice(index, index + 5).map(order =>
            unregisterChatPushToken(order.id, ADMIN_ACTOR, token)
        ));
        if (results.some(result => result.status === "rejected")) {
            throw new Error("push-unregistration-failed");
        }
    }
}

async function enableAdminPush({ requestPermission = false, quiet = false, force = false } = {}) {
    if (adminNotificationsOptedOut() && !force) {
        renderAdminNotificationButton();
        return null;
    }
    if (force) localStorage.removeItem(ADMIN_NOTIFICATIONS_DISABLED_KEY);
    try {
        const token = await getBrowserPushToken({ requestPermission });
        if (!token) {
            adminPushToken = "";
            renderAdminNotificationButton();
            if (!quiet && requestPermission) {
                showToast("فعّل الإشعارات من إعدادات المتصفح ثم حاول مجددًا");
            }
            return null;
        }
        if (adminNotificationsOptedOut() && !force) {
            await unregisterAdminTokenFromAllOrders(token).catch(console.error);
            renderAdminNotificationButton();
            return null;
        }
        adminPushToken = token;
        await registerAdminTokenForConversations(token);
        if (adminNotificationsOptedOut() && !force) {
            adminPushToken = "";
            await unregisterAdminTokenFromAllOrders(token).catch(console.error);
            renderAdminNotificationButton();
            return null;
        }
        renderAdminNotificationButton();
        if (!quiet) showToast("تم تفعيل إشعارات الإدارة");
        return token;
    } catch (error) {
        console.error("Admin push registration failed", error);
        adminPushToken = "";
        renderAdminNotificationButton();
        if (!quiet) showToast("تعذر تفعيل الإشعارات الآن");
        return null;
    }
}

async function disableAdminPush() {
    const firstConfirmation = await requestAdminConfirmation({
        title: "تعطيل الإشعارات؟",
        message: "هل تريد بالفعل إلغاء إشعارات الإدارة على هذا الجهاز؟",
        acceptText: "متابعة"
    });
    if (!firstConfirmation) return false;

    const finalConfirmation = await requestAdminConfirmation({
        title: "تحذير قبل التعطيل",
        message: "بعد التعطيل لن تظهر للإدارة تنبيهات رسائل المستفيدين الجديدة على هذا الجهاز حتى تعيد تشغيلها، وستستمر الإشعارات بصورة مستقلة على أجهزة الإدارة الأخرى.",
        acceptText: "تعطيل على هذا الجهاز"
    });
    if (!finalConfirmation) return false;

    const token = adminPushToken;
    localStorage.setItem(ADMIN_NOTIFICATIONS_DISABLED_KEY, "yes");
    adminPushToken = "";
    renderAdminNotificationButton();
    try {
        await unregisterAdminTokenFromAllOrders(token);
        showToast("تم تعطيل إشعارات هذا الجهاز فقط");
        return true;
    } catch (error) {
        console.error("Admin push unregistration failed", error);
        localStorage.removeItem(ADMIN_NOTIFICATIONS_DISABLED_KEY);
        adminPushToken = token;
        renderAdminNotificationButton();
        showToast("تعذر تعطيل الإشعارات الآن");
        return false;
    }
}

function unlockAdmin() {
    adminLock.hidden = true;
    adminChatApp.hidden = false;
    renderAdminNotificationButton();
    if (!unsubscribeOrders) listenToConversations();
    if ("Notification" in window && Notification.permission === "granted" && !adminNotificationsOptedOut()) {
        enableAdminPush({ quiet: true });
    }
}

function conversationTimestamp(order) {
    if (order.chatUpdatedAt?.seconds) return order.chatUpdatedAt.seconds * 1000;
    const messages = sortMessages(order.chatMessages);
    return new Date(messages.at(-1)?.clientTime || order.createdAt?.seconds * 1000 || 0).getTime();
}

function unreadCount(order) {
    return sortMessages(order.chatMessages).filter(message =>
        message.senderId === CLIENT_ACTOR &&
        !message.deletedForAll &&
        !(Array.isArray(message.readBy) && message.readBy.includes(ADMIN_ACTOR))
    ).length;
}

function needsAdminDelivery(order) {
    return sortMessages(order.chatMessages).some(message =>
        message.senderId === CLIENT_ACTOR &&
        !message.deletedForAll &&
        !(Array.isArray(message.deliveredBy) && message.deliveredBy.includes(ADMIN_ACTOR)) &&
        !(Array.isArray(message.readBy) && message.readBy.includes(ADMIN_ACTOR))
    );
}

function acknowledgeListedDeliveries(orders) {
    orders.forEach(order => {
        if (currentOrder?.id === order.id || deliveryAckOrders.has(order.id) || !needsAdminDelivery(order)) return;
        deliveryAckOrders.add(order.id);
        markMessagesDelivered(order.id, ADMIN_ACTOR)
            .catch(error => console.error("Message delivery acknowledgement failed", error))
            .finally(() => deliveryAckOrders.delete(order.id));
    });
}

function listenToConversations() {
    unsubscribeOrders = onSnapshot(collection(db, "orders"), snapshot => {
        const orders = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .filter(order => order.chatEnabled === true || (Array.isArray(order.chatMessages) && order.chatMessages.length))
            .sort((a, b) => {
                const pinDifference = Number(b.chatPinnedBy?.[ADMIN_ACTOR] === true) -
                    Number(a.chatPinnedBy?.[ADMIN_ACTOR] === true);
                return pinDifference || conversationTimestamp(b) - conversationTimestamp(a);
            });

        const clientMessages = orders.flatMap(order =>
            sortMessages(order.chatMessages)
                .filter(message => message.senderId === CLIENT_ACTOR)
                .map(message => ({ ...message, order }))
        );
        const newMessages = clientMessages.filter(message => !knownClientMessageIds.has(message.id));

        allConversations = orders;
        renderConversationList();
        acknowledgeListedDeliveries(orders);
        if (adminPushToken) registerAdminTokenForConversations(adminPushToken).catch(console.error);

        if (!notificationOrderHandled) {
            const requestedOrderId = new URLSearchParams(location.search).get("order");
            if (requestedOrderId && orders.some(order => order.id === requestedOrderId)) {
                notificationOrderHandled = true;
                selectConversation(requestedOrderId);
            }
        }

        if (currentOrder) {
            const updated = orders.find(order => order.id === currentOrder.id);
            if (updated) {
                currentOrder = updated;
                renderCurrentConversation();
            } else {
                resetAdminConversationView();
            }
        }

        if (initialSnapshotLoaded && newMessages.length) {
            const latest = newMessages.sort((a, b) => new Date(a.clientTime) - new Date(b.clientTime)).at(-1);
            notifyAdmin(latest);
        }
        knownClientMessageIds = new Set(clientMessages.map(message => message.id));
        initialSnapshotLoaded = true;
    }, error => {
        console.error(error);
        conversationList.innerHTML = '<div class="loading-chat">تعذر تحميل المحادثات.</div>';
    });
}

function renderConversationList() {
    const queryText = normalizeDigits(conversationSearch.value).trim().toLowerCase();
    const visible = queryText
        ? allConversations.filter(order => [order.name, order.transactionId, order.phone, order.chatLastMessage]
            .join(" ").toLowerCase().includes(queryText))
        : allConversations;

    conversationCount.textContent = `${visible.length.toLocaleString("ar")} محادثة`;
    conversationList.textContent = "";

    if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "loading-chat";
        empty.textContent = "لا توجد محادثات مطابقة.";
        conversationList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach(order => {
        const pinned = order.chatPinnedBy?.[ADMIN_ACTOR] === true;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `conversation-item${currentOrder?.id === order.id ? " active" : ""}${pinned ? " pinned" : ""}`;

        const avatar = document.createElement("span");
        avatar.className = "conversation-avatar";
        avatar.textContent = String(order.name || "م").trim().charAt(0) || "م";

        const content = document.createElement("span");
        content.className = "conversation-content";
        const title = document.createElement("span");
        title.className = "conversation-title";
        title.textContent = order.name || "مستفيد بدون اسم";
        const preview = document.createElement("span");
        preview.className = "conversation-preview";
        preview.textContent = `#${order.transactionId || "—"} • ${order.chatLastMessage || "تم إنشاء المحادثة"}`;
        content.append(title, preview);

        const side = document.createElement("span");
        side.className = "conversation-side";
        const time = document.createElement("span");
        time.textContent = new Date(conversationTimestamp(order)).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
        side.appendChild(time);
        if (pinned) {
            const pin = document.createElement("span");
            pin.className = "conversation-pin";
            pin.textContent = "📌";
            pin.title = "محادثة مثبتة";
            side.appendChild(pin);
        }
        const unread = unreadCount(order);
        if (unread) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent = unread > 99 ? "+99" : String(unread);
            side.appendChild(badge);
        }

        button.append(avatar, content, side);
        button.addEventListener("click", () => selectConversation(order.id));
        fragment.appendChild(button);
    });
    conversationList.appendChild(fragment);
}

async function selectConversation(orderId) {
    voiceRecorder?.cancel();
    const order = allConversations.find(item => item.id === orderId);
    if (!order) return;
    if (currentOrder && currentOrder.id !== order.id) {
        await setChatPresence(currentOrder.id, ADMIN_ACTOR, false);
    }
    exitSelectionMode(false);
    currentOrder = order;
    renderedMessagesSignature = "";
    replyTarget = null;
    replyPreview.hidden = true;
    messageSearchQuery = "";
    adminMessageSearchInput.value = "";
    adminMessageSearchBar.hidden = true;
    starredOnly = false;
    adminStarredMessagesButton.classList.remove("active");
    adminStarredMessagesButton.textContent = "☆";
    adminEmpty.hidden = true;
    adminChatTop.hidden = false;
    adminMessagesArea.hidden = false;
    adminComposerZone.hidden = false;
    adminChatApp.classList.add("conversation-open");
    renderConversationList();
    renderCurrentConversation();
    await setChatPresence(order.id, ADMIN_ACTOR, true);
    if (adminPushToken) await registerChatPushToken(order.id, ADMIN_ACTOR, adminPushToken);
    messageInput.focus();
}

function messageRenderSignature(messages) {
    return JSON.stringify([
        currentOrder?.id,
        currentOrder?.chatPinnedMessage?.[ADMIN_ACTOR] || "",
        selectionMode,
        [...selectedMessageIds].sort(),
        messageSearchQuery,
        starredOnly,
        messages.map(message => [
            message.id,
            message.text,
            message.messageType,
            message.uploadStatus,
            message.mediaPath,
            message.mediaPreviewPath,
            message.audioUrl,
            message.media?.url,
            message.media?.path,
            message.deletedForAll,
            message.replyTo?.id,
            message.deliveredBy,
            message.readBy,
            message.starredBy,
            message.deletedFor
        ])
    ]);
}

async function acknowledgeIncomingMessages(order) {
    if (!order?.id) return;
    if (messageAckRunning) {
        messageAckPending = true;
        return;
    }
    const incoming = sortMessages(order.chatMessages).filter(message =>
        message.senderId !== ADMIN_ACTOR && !message.deletedForAll
    );
    const isReadingNow = document.visibilityState === "visible" && document.hasFocus() &&
        !adminChatApp.hidden && !adminComposerZone.hidden;
    const needsRead = isReadingNow && incoming.some(message =>
        !(Array.isArray(message.readBy) && message.readBy.includes(ADMIN_ACTOR))
    );
    const needsDelivery = incoming.some(message =>
        !(Array.isArray(message.deliveredBy) && message.deliveredBy.includes(ADMIN_ACTOR))
    );
    if (!needsRead && !needsDelivery) return;

    messageAckRunning = true;
    try {
        if (needsRead) await markMessagesRead(order.id, ADMIN_ACTOR);
        else await markMessagesDelivered(order.id, ADMIN_ACTOR);
    } catch (error) {
        console.error("Message acknowledgement failed", error);
    } finally {
        messageAckRunning = false;
        if (messageAckPending) {
            messageAckPending = false;
            if (currentOrder) queueMicrotask(() => acknowledgeIncomingMessages(currentOrder));
        }
    }
}

function messageSummary(message) {
    if (!message) return "";
    if (message.deletedForAll) return "تم حذف هذه الرسالة";
    if (message.messageType === "audio") return "رسالة صوتية";
    if (message.messageType === "image") return "صورة";
    if (message.messageType === "video") return "فيديو";
    if (message.messageType === "file") return message.mediaName || "ملف";
    return String(message.text || "رسالة").replace(/\s+/g, " ").trim().slice(0, 140);
}

function renderPinnedMessage(order) {
    const pinnedId = String(order?.chatPinnedMessage?.[ADMIN_ACTOR] || "");
    const message = sortMessages(order?.chatMessages).find(item =>
        item.id === pinnedId &&
        !item.deletedForAll &&
        !(Array.isArray(item.deletedFor) && item.deletedFor.includes(ADMIN_ACTOR))
    );
    if (!message) {
        pinnedMessageBar.hidden = true;
        pinnedMessageBar.dataset.messageId = "";
        return;
    }
    pinnedMessageBar.dataset.messageId = message.id;
    pinnedMessageSender.textContent = message.senderName || (message.senderId === ADMIN_ACTOR ? "إدارة المؤسسة" : "المستفيد");
    pinnedMessageText.textContent = messageSummary(message);
    pinnedMessageBar.hidden = false;
}

function getSelectedMessages() {
    const messages = sortMessages(currentOrder?.chatMessages).filter(message =>
        selectedMessageIds.has(message.id) &&
        !(Array.isArray(message.deletedFor) && message.deletedFor.includes(ADMIN_ACTOR))
    );
    const validIds = new Set(messages.map(message => message.id));
    [...selectedMessageIds].forEach(id => {
        if (!validIds.has(id)) selectedMessageIds.delete(id);
    });
    return messages;
}

function updateSelectionToolbar() {
    if (!selectionMode) {
        selectionBar.hidden = true;
        return;
    }
    const messages = getSelectedMessages();
    if (!messages.length) {
        exitSelectionMode(false);
        return;
    }
    const count = messages.length;
    selectionBar.hidden = false;
    selectionCount.textContent = count === 1 ? "رسالة واحدة" : `${count.toLocaleString("ar")} رسائل`;
    const allStarred = messages.every(message =>
        Array.isArray(message.starredBy) && message.starredBy.includes(ADMIN_ACTOR)
    );
    selectionStar.textContent = allStarred ? "★" : "☆";
    selectionStar.title = allStarred ? "إزالة النجمة" : "تمييز بنجمة";
    selectionStar.setAttribute("aria-label", selectionStar.title);
    selectionPin.disabled = count !== 1 || messages[0].deletedForAll;
    selectionDeleteAll.hidden = !messages.every(message =>
        message.senderId === ADMIN_ACTOR && !message.deletedForAll
    );
}

function enterSelectionMode(message) {
    if (!message) return;
    closeMessageMenu();
    selectionMode = true;
    selectedMessageIds.clear();
    selectedMessageIds.add(message.id);
    messageSearchQuery = "";
    adminMessageSearchInput.value = "";
    adminMessageSearchBar.hidden = true;
    starredOnly = false;
    adminStarredMessagesButton.classList.remove("active");
    adminStarredMessagesButton.textContent = "☆";
    renderedMessagesSignature = "";
    renderCurrentConversation();
}

function exitSelectionMode(shouldRender = true) {
    selectionMode = false;
    selectedMessageIds.clear();
    selectionBar.hidden = true;
    adminMessagesList.querySelectorAll(".message-row.selected").forEach(row => row.classList.remove("selected"));
    if (shouldRender && currentOrder) {
        renderedMessagesSignature = "";
        renderCurrentConversation();
    }
}

function toggleMessageSelection(message) {
    if (!selectionMode || !message) return;
    if (selectedMessageIds.has(message.id)) selectedMessageIds.delete(message.id);
    else selectedMessageIds.add(message.id);
    if (!selectedMessageIds.size) {
        exitSelectionMode();
        return;
    }
    renderedMessagesSignature = "";
    renderCurrentConversation();
}

function scrollToMessage(messageId) {
    if (!currentOrder || !messageId) return;
    exitSelectionMode(false);
    messageSearchQuery = "";
    adminMessageSearchInput.value = "";
    adminMessageSearchBar.hidden = true;
    starredOnly = false;
    adminStarredMessagesButton.classList.remove("active");
    adminStarredMessagesButton.textContent = "☆";
    renderedMessagesSignature = "";
    renderCurrentConversation();
    requestAnimationFrame(() => {
        const target = [...adminMessagesList.querySelectorAll("[data-message-id]")]
            .find(element => element.dataset.messageId === messageId);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("message-highlight");
        setTimeout(() => target.classList.remove("message-highlight"), 1600);
    });
}

function requestAdminConfirmation({ title, message, acceptText = "تأكيد" }) {
    if (confirmationResolver) confirmationResolver(false);
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmAccept.textContent = acceptText;
    confirmModal.hidden = false;
    requestAnimationFrame(() => confirmAccept.focus());
    return new Promise(resolve => { confirmationResolver = resolve; });
}

function settleAdminConfirmation(accepted) {
    confirmModal.hidden = true;
    const resolve = confirmationResolver;
    confirmationResolver = null;
    if (resolve) resolve(Boolean(accepted));
}

function resetAdminConversationView() {
    voiceRecorder?.cancel();
    exitSelectionMode(false);
    currentOrder = null;
    activeMessage = null;
    renderedMessagesSignature = "";
    clearReply();
    pinnedMessageBar.hidden = true;
    adminChatTop.hidden = true;
    adminMessagesArea.hidden = true;
    adminComposerZone.hidden = true;
    adminMessagesList.textContent = "";
    adminEmpty.hidden = false;
    adminChatApp.classList.remove("conversation-open");
    renderConversationList();
}

function renderCurrentConversation() {
    if (!currentOrder) return;
    clientName.textContent = currentOrder.name || "المستفيد";
    clientAvatar.textContent = String(currentOrder.name || "م").trim().charAt(0) || "م";
    adminOrderBadge.textContent = `#${currentOrder.transactionId || "----"}`;
    const phone = String(currentOrder.phone || "").replace(/[^0-9]/g, "");
    clientWhatsapp.href = `https://wa.me/${phone || "966580272758"}?text=${encodeURIComponent(`السلام عليكم، بخصوص معاملتك رقم ${currentOrder.transactionId || ""}`)}`;

    if (currentOrder.chatTyping?.client === true) {
        clientStatus.textContent = "المستفيد يكتب الآن...";
        clientStatus.className = "typing-text";
    } else if (currentOrder.chatOnline?.client === true) {
        clientStatus.textContent = "● متصل الآن";
        clientStatus.className = "online-dot";
    } else {
        clientStatus.textContent = "غير متصل";
        clientStatus.className = "";
    }
    adminTypingBar.hidden = currentOrder.chatTyping?.client !== true;
    renderPinnedMessage(currentOrder);
    const serverMessages = sortMessages(currentOrder.chatMessages);
    serverMessages.forEach(message => optimisticMessages.delete(message.id));
    const pendingMessages = [...optimisticMessages.values()].filter(message => !serverMessages.some(item => item.id === message.id));
    const allMessages = sortMessages([...serverMessages, ...pendingMessages])
        .filter(message => !(Array.isArray(message.deletedFor) && message.deletedFor.includes(ADMIN_ACTOR)));
    const query = messageSearchQuery.trim().toLowerCase();
    const visibleMessages = allMessages.filter(message => {
        const matchesSearch = !query || String(message.text || "").toLowerCase().includes(query);
        const matchesStar = !starredOnly || (Array.isArray(message.starredBy) && message.starredBy.includes(ADMIN_ACTOR));
        return matchesSearch && matchesStar;
    });
    adminMessageSearchCount.textContent = query || starredOnly ? `${visibleMessages.length} نتيجة` : "";
    const nextSignature = messageRenderSignature(visibleMessages);
    if (nextSignature !== renderedMessagesSignature) {
        renderMessages(visibleMessages);
        renderedMessagesSignature = nextSignature;
    }
    updateSelectionToolbar();

    acknowledgeIncomingMessages(currentOrder);
}

function renderMessages(messages) {
    const wasNearBottom = adminMessagesArea.scrollHeight - adminMessagesArea.scrollTop - adminMessagesArea.clientHeight < 130;
    adminMessagesList.textContent = "";
    if (!messages.length) {
        const empty = document.createElement("div");
        empty.className = "empty-chat";
        empty.textContent = messageSearchQuery || starredOnly ? "لا توجد رسائل مطابقة." : "لا توجد رسائل في هذه المحادثة.";
        adminMessagesList.appendChild(empty);
        return;
    }
    let activeDate = "";
    const fragment = document.createDocumentFragment();

    messages.forEach(message => {
        const date = formatMessageDate(message.clientTime);
        if (date && date !== activeDate) {
            activeDate = date;
            const divider = document.createElement("div");
            divider.className = "day-divider";
            divider.textContent = date;
            fragment.appendChild(divider);
        }
        fragment.appendChild(createMessageElement(message));
    });
    adminMessagesList.appendChild(fragment);
    if (wasNearBottom) requestAnimationFrame(() => { adminMessagesArea.scrollTop = adminMessagesArea.scrollHeight; });
}

function createMessageElement(message) {
    const mine = message.senderId === ADMIN_ACTOR;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : "theirs"}${selectedMessageIds.has(message.id) ? " selected" : ""}`;
    row.dataset.messageId = message.id;
    const bubble = document.createElement("article");
    bubble.className = "message-bubble";
    bubble.tabIndex = 0;
    bubble.dataset.messageId = message.id;

    if (message.replyTo) {
        const quote = document.createElement("div");
        quote.className = "reply-quote";
        const sender = document.createElement("strong");
        sender.textContent = message.replyTo.senderName || "رسالة";
        const text = document.createElement("span");
        text.textContent = message.replyTo.text || "";
        quote.append(sender, text);
        bubble.appendChild(quote);
    }

    const isAudio = message.messageType === "audio" && !message.deletedForAll;
    const isMedia = ["image", "video", "file"].includes(message.messageType) && !message.deletedForAll;
    const content = isAudio
        ? createAudioMessagePlayer(message, currentOrder?.id)
        : isMedia
            ? createMediaMessageContent(message, currentOrder?.id)
            : document.createElement("div");
    if (!isAudio && !isMedia) {
        content.className = `message-text${message.deletedForAll ? " deleted" : ""}`;
    }
    if (Array.isArray(message.starredBy) && message.starredBy.includes(ADMIN_ACTOR)) {
        const star = document.createElement("span");
        star.className = "message-star";
        star.textContent = "★";
        content.prepend(star);
    }
    if (currentOrder?.chatPinnedMessage?.[ADMIN_ACTOR] === message.id) {
        const pin = document.createElement("span");
        pin.className = "message-pin";
        pin.textContent = "📌";
        content.prepend(pin);
    }
    if (!isAudio && !isMedia) content.appendChild(document.createTextNode(message.text || ""));

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("span");
    time.textContent = formatMessageTime(message.clientTime);
    meta.appendChild(time);
    if (mine) {
        const read = Array.isArray(message.readBy) && message.readBy.includes(CLIENT_ACTOR);
        const delivered = read || (Array.isArray(message.deliveredBy) && message.deliveredBy.includes(CLIENT_ACTOR));
        const checks = document.createElement("span");
        checks.className = `message-checks${read ? " read" : delivered ? " delivered" : " sent"}`;
        checks.textContent = delivered ? "✓✓" : "✓";
        checks.title = read ? "تمت القراءة" : delivered ? "تم التسليم" : "تم الإرسال";
        meta.appendChild(checks);
    }
    bubble.append(content, meta);

    bubble.addEventListener("click", event => {
        if (!selectionMode) return;
        event.preventDefault();
        event.stopPropagation();
        toggleMessageSelection(message);
    }, true);
    bubble.addEventListener("contextmenu", event => {
        if (selectionMode) {
            event.preventDefault();
            toggleMessageSelection(message);
            return;
        }
        openMessageMenu(event, message);
    });
    bubble.addEventListener("dblclick", event => {
        if (!selectionMode) openMessageMenu(event, message);
    });
    bubble.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" || selectionMode) return;
        clearTimeout(longPressTimer);
        longPressOrigin = { x: event.clientX, y: event.clientY };
        longPressTimer = setTimeout(() => openMessageMenu(event, message), 560);
    });
    bubble.addEventListener("pointermove", event => {
        const distance = Math.abs(event.clientX - longPressOrigin.x) + Math.abs(event.clientY - longPressOrigin.y);
        if (distance > 12) clearTimeout(longPressTimer);
    });
    bubble.addEventListener("pointerup", () => clearTimeout(longPressTimer));
    bubble.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
    row.appendChild(bubble);
    return row;
}

function openMessageMenu(event, message) {
    event.preventDefault();
    activeMessage = message;
    const deleteAll = messageMenu.querySelector('[data-action="delete-all"]');
    deleteAll.hidden = message.senderId !== ADMIN_ACTOR || message.deletedForAll;
    const star = messageMenu.querySelector('[data-action="star"]');
    star.textContent = Array.isArray(message.starredBy) && message.starredBy.includes(ADMIN_ACTOR)
        ? "☆ إزالة النجمة" : "⭐ تمييز بنجمة";
    const pinMessage = messageMenu.querySelector('[data-action="pin-message"]');
    const isMessagePinned = currentOrder?.chatPinnedMessage?.[ADMIN_ACTOR] === message.id;
    pinMessage.hidden = message.deletedForAll;
    pinMessage.textContent = isMessagePinned ? "📌 إلغاء تثبيت الرسالة" : "📌 تثبيت الرسالة";
    const pinConversation = messageMenu.querySelector('[data-action="pin-conversation"]');
    pinConversation.textContent = currentOrder?.chatPinnedBy?.[ADMIN_ACTOR] === true
        ? "📍 إلغاء تثبيت المحادثة" : "📍 تثبيت المحادثة";

    messageMenu.hidden = false;
    messageMenuOpenedAt = Date.now();
    messageMenu.scrollTop = 0;
    const rect = messageMenu.getBoundingClientRect();
    const preferredX = Number(event.clientX) || window.innerWidth / 2;
    const preferredY = Number(event.clientY) || window.innerHeight / 2;
    const x = Math.min(Math.max(8, preferredX), Math.max(8, window.innerWidth - rect.width - 8));
    const y = Math.min(Math.max(8, preferredY), Math.max(8, window.innerHeight - rect.height - 8));
    messageMenu.style.left = `${x}px`;
    messageMenu.style.top = `${y}px`;
}

function closeMessageMenu() { messageMenu.hidden = true; }

function setReply(message) {
    replyTarget = message;
    replySender.textContent = message.senderName || "المستفيد";
    replyText.textContent = message.text || "";
    replyPreview.hidden = false;
    messageInput.focus();
}

function clearReply() {
    replyTarget = null;
    replyPreview.hidden = true;
}

function updateComposerAction() {
    const hasText = Boolean(messageInput.value.trim());
    composerActionIcon.dataset.mode = hasText ? "send" : "voice";
    sendButton.classList.toggle("is-voice", !hasText);
    sendButton.setAttribute("aria-label", hasText ? "إرسال" : "تسجيل رسالة صوتية");
    sendButton.title = hasText ? "إرسال" : "تسجيل رسالة صوتية";
}

async function sendRecordedVoice(blob, { duration, mimeType }) {
    if (!currentOrder) throw new Error("order-not-found");
    const orderId = currentOrder.id;
    await enableAdminPush({ requestPermission: true, quiet: true });
    const pending = await createPendingAudioMessage(
        orderId,
        ADMIN_ACTOR,
        duration,
        mimeType,
        replyTarget
    );
    try {
        await uploadChatAudio({
            orderId,
            senderId: ADMIN_ACTOR,
            messageId: pending.id,
            blob,
            duration
        });
    } catch (error) {
        await markChatAudioFailed(orderId, pending.id).catch(console.error);
        throw error;
    }

    clearReply();
    emojiPanel.hidden = true;
    sendPushForMessage({
        orderId,
        senderId: ADMIN_ACTOR,
        messageId: pending.id
    }).catch(error => console.warn("Voice push send failed", error));
}

function showOptimisticMediaMessage(message) {
    if (messageSearchQuery || starredOnly) return;
    adminMessagesList.querySelector(".empty-chat")?.remove();
    adminMessagesList.appendChild(createMessageElement(message));
    requestAnimationFrame(() => { adminMessagesArea.scrollTop = adminMessagesArea.scrollHeight; });
}

function removeOptimisticMediaMessage(messageId) {
    adminMessagesList.querySelector(`[data-message-id="${String(messageId)}"]`)?.closest(".message-row")?.remove();
}

async function sendSelectedMedia(files) {
    if (!currentOrder || !files?.length) return;
    attachmentSheet.hidden = true;
    await enableAdminPush({ requestPermission: true, quiet: true });
    const selected = [...files].slice(0, 5);
    if (files.length > 5) showToast("يمكن إرسال 5 ملفات في المرة الواحدة");

    for (const file of selected) {
        if (file.size > 25 * 1024 * 1024) {
            showToast(`الملف ${file.name} أكبر من 25 ميجابايت`);
            continue;
        }
        const orderId = currentOrder.id;
        const messageId = createMessageId();
        primeLocalMediaPreview(messageId, file);
        let pending = null;
        try {
            pending = await createPendingMediaMessage(
                orderId,
                ADMIN_ACTOR,
                file,
                replyTarget,
                messageId,
                showOptimisticMediaMessage
            );
            await uploadChatMedia({
                orderId,
                senderId: ADMIN_ACTOR,
                messageId,
                file
            });
            clearReply();
            sendPushForMessage({
                orderId,
                senderId: ADMIN_ACTOR,
                messageId
            }).catch(error => console.warn("Media push send failed", error));
        } catch (error) {
            console.error("Media send failed", error);
            if (pending) await markChatMediaFailed(orderId, messageId).catch(console.error);
            else {
                removeOptimisticMediaMessage(messageId);
                releaseLocalMediaPreview(messageId);
            }
            showToast(error?.message === "supabase-media-not-configured"
                ? "تأكد من إعداد تخزين Supabase"
                : `تعذر إرسال ${file.name}`);
        }
    }
}

async function handleMenuAction(action) {
    const message = activeMessage;
    closeMessageMenu();
    if (!message || !currentOrder) return;
    const orderId = currentOrder.id;
    try {
        if (action === "reply") setReply(message);
        if (action === "copy") {
            await navigator.clipboard.writeText(message.text || "");
            showToast("تم نسخ الرسالة");
        }
        if (action === "forward") {
            messageInput.value = `↪️ رسالة محوّلة\n${message.text || ""}`;
            resizeInput();
            updateComposerAction();
            messageInput.focus();
        }
        if (action === "pin-message") {
            const pinned = await togglePinnedMessage(orderId, message.id, ADMIN_ACTOR);
            showToast(pinned ? "تم تثبيت الرسالة" : "تم إلغاء تثبيت الرسالة");
        }
        if (action === "pin-conversation") {
            const pinned = await toggleConversationPin(orderId, ADMIN_ACTOR);
            showToast(pinned ? "تم تثبيت المحادثة أعلى القائمة" : "تم إلغاء تثبيت المحادثة");
        }
        if (action === "select") enterSelectionMode(message);
        if (action === "star") await toggleMessageStar(orderId, message.id, ADMIN_ACTOR);
        if (action === "delete-me") {
            const accepted = await requestAdminConfirmation({
                title: "حذف الرسالة لدي",
                message: "ستختفي هذه الرسالة من صفحة الإدارة فقط، وستبقى ظاهرة للطرف الآخر.",
                acceptText: "حذف لدي"
            });
            if (accepted) await deleteMessageForMe(orderId, message.id, ADMIN_ACTOR);
        }
        if (action === "delete-all") {
            const accepted = await requestAdminConfirmation({
                title: "حذف الرسالة لدى الجميع",
                message: "سيُستبدل محتوى الرسالة بإشعار يفيد بأنها حُذفت لدى الإدارة والمستفيد.",
                acceptText: "حذف لدى الجميع"
            });
            if (accepted) await deleteMessageForEveryone(orderId, message.id, ADMIN_ACTOR);
        }
        if (action === "delete-conversation") {
            const transactionLabel = currentOrder.transactionId ? ` رقم ${currentOrder.transactionId}` : "";
            const accepted = await requestAdminConfirmation({
                title: "حذف المحادثة كاملة",
                message: `سيتم حذف جميع رسائل المحادثة${transactionLabel} نهائيًا من سجل الدردشة مع بقاء الطلب نفسه. لا يمكن التراجع عن هذه العملية.`,
                acceptText: "حذف المحادثة"
            });
            if (!accepted) return;
            await clearConversationMessages(orderId, ADMIN_ACTOR);
            allConversations = allConversations.filter(order => order.id !== orderId);
            resetAdminConversationView();
            showToast("تم حذف سجل المحادثة");
        }
        if (action === "info") showMessageInfo(message);
    } catch (error) {
        console.error(error);
        showToast("تعذر تنفيذ العملية");
    }
}

function showMessageInfo(message) {
    const read = Array.isArray(message.readBy) && message.readBy.includes(CLIENT_ACTOR);
    const delivered = read || (Array.isArray(message.deliveredBy) && message.deliveredBy.includes(CLIENT_ACTOR));
    const pinned = currentOrder?.chatPinnedMessage?.[ADMIN_ACTOR] === message.id;
    infoBody.textContent = "";
    [
        `المرسل: ${message.senderName || "غير محدد"}`,
        `وقت الإرسال: ${new Date(message.clientTime).toLocaleString("ar-SA")}`,
        `حالة الرسالة: ${read ? "تمت القراءة" : delivered ? "تم التسليم" : "تم الإرسال"}`,
        `التثبيت: ${pinned ? "مثبتة أعلى المحادثة" : "غير مثبتة"}`,
        `معرّف الرسالة: ${message.id}`
    ].forEach(line => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        infoBody.appendChild(paragraph);
    });
    infoModal.hidden = false;
}

function closeInfo() { infoModal.hidden = true; }

function resizeInput() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 125)}px`;
}

function buildEmojiPanel() {
    const fragment = document.createDocumentFragment();
    EMOJIS.forEach(emoji => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = emoji;
        button.addEventListener("click", () => {
            const start = messageInput.selectionStart;
            messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(messageInput.selectionEnd);
            messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
            messageInput.focus();
            resizeInput();
            updateComposerAction();
        });
        fragment.appendChild(button);
    });
    emojiPanel.appendChild(fragment);
}

function notifyAdmin(message) {
    if (!adminNotificationsEnabled()) return;
    showToast(`🔔 رسالة جديدة من ${message.order.name || "مستفيد"}: ${String(message.text || "").slice(0, 70)}`);
    try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 760;
        gain.gain.setValueAtTime(.08, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .2);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + .2);
    } catch { /* اختياري */ }
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification(`رسالة جديدة من ${message.order.name || "مستفيد"}`, {
            body: String(message.text || "رسالة جديدة").slice(0, 150),
            icon: "../icons/chat-app-192.png"
        });
    }
}

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (isAdminAppContext()) return markAdminAppInstalled();
    localStorage.removeItem(ADMIN_INSTALL_KEY);
    deferredAdminInstallPrompt = event;
    installAdminChatAppButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
    markAdminAppInstalled();
    showToast("تم تثبيت تطبيق إدارة المحادثات بنجاح");
});

installAdminChatAppButton.addEventListener("click", async () => {
    if (isAdminAppContext()) {
        markAdminAppInstalled();
        return;
    }

    if (deferredAdminInstallPrompt) {
        deferredAdminInstallPrompt.prompt();
        const choice = await deferredAdminInstallPrompt.userChoice;
        if (choice.outcome === "accepted") markAdminAppInstalled();
        deferredAdminInstallPrompt = null;
        return;
    }

    showToast(/iphone|ipad|ipod/i.test(navigator.userAgent)
        ? "من زر المشاركة اختر: إضافة إلى الشاشة الرئيسية"
        : "من قائمة المتصفح اختر: تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية");
});

const adminDisplayModeQuery = window.matchMedia("(display-mode: standalone)");
if (typeof adminDisplayModeQuery.addEventListener === "function") {
    adminDisplayModeQuery.addEventListener("change", event => {
        if (event.matches) markAdminAppInstalled();
    });
}

if (isAdminAppContext()) {
    markAdminAppInstalled();
} else if (localStorage.getItem(ADMIN_INSTALL_KEY) !== "yes") {
    // نظهره دائماً في المتصفح، ثم نخفيه بعد التثبيت أو داخل التطبيق المستقل.
    installAdminChatAppButton.hidden = false;
}

loginForm.addEventListener("submit", event => {
    event.preventDefault();
    if (adminPassword.value === ADMIN_PASSWORD) {
        localStorage.setItem("adminLogin", "yes");
        loginError.textContent = "";
        enableAdminPush({ requestPermission: true, quiet: true }).catch(console.error);
        unlockAdmin();
    } else {
        loginError.textContent = "كلمة المرور غير صحيحة";
    }
});

document.getElementById("adminLogoutButton").addEventListener("click", async () => {
    voiceRecorder?.cancel();
    if (currentOrder) await setChatPresence(currentOrder.id, ADMIN_ACTOR, false);
    localStorage.removeItem("adminLogin");
    location.reload();
});

adminNotificationButton.addEventListener("click", async () => {
    if (adminNotificationToggleBusy) return;
    adminNotificationToggleBusy = true;
    renderAdminNotificationButton();
    try {
        if (adminNotificationsEnabled()) await disableAdminPush();
        else await enableAdminPush({ requestPermission: true, force: true });
    } finally {
        adminNotificationToggleBusy = false;
        renderAdminNotificationButton();
    }
});

document.getElementById("adminMessageSearchButton").addEventListener("click", () => {
    adminMessageSearchBar.hidden = !adminMessageSearchBar.hidden;
    if (!adminMessageSearchBar.hidden) adminMessageSearchInput.focus();
});

document.getElementById("adminCloseMessageSearch").addEventListener("click", () => {
    adminMessageSearchBar.hidden = true;
    adminMessageSearchInput.value = "";
    messageSearchQuery = "";
    renderCurrentConversation();
});

adminMessageSearchInput.addEventListener("input", () => {
    messageSearchQuery = adminMessageSearchInput.value;
    renderCurrentConversation();
});

adminStarredMessagesButton.addEventListener("click", () => {
    starredOnly = !starredOnly;
    adminStarredMessagesButton.classList.toggle("active", starredOnly);
    adminStarredMessagesButton.textContent = starredOnly ? "★" : "☆";
    renderCurrentConversation();
});

document.getElementById("adminCancelSelection").addEventListener("click", () => exitSelectionMode());

document.getElementById("adminSelectionCopy").addEventListener("click", async () => {
    const messages = getSelectedMessages();
    if (!messages.length) return;
    const text = messages.map(message => `${message.senderName || "رسالة"}: ${messageSummary(message)}`).join("\n");
    try {
        await navigator.clipboard.writeText(text);
        showToast("تم نسخ الرسائل المحددة");
    } catch (error) {
        console.error(error);
        showToast("تعذر نسخ الرسائل");
    }
});

selectionStar.addEventListener("click", async () => {
    if (!currentOrder) return;
    const messages = getSelectedMessages();
    if (!messages.length) return;
    const shouldStar = !messages.every(message =>
        Array.isArray(message.starredBy) && message.starredBy.includes(ADMIN_ACTOR)
    );
    try {
        await setMessagesStarred(currentOrder.id, messages.map(message => message.id), ADMIN_ACTOR, shouldStar);
        showToast(shouldStar ? "تم تمييز الرسائل" : "تمت إزالة النجمة");
    } catch (error) {
        console.error(error);
        showToast("تعذر تمييز الرسائل");
    }
});

selectionPin.addEventListener("click", async () => {
    if (!currentOrder) return;
    const [message] = getSelectedMessages();
    if (!message || selectedMessageIds.size !== 1) return;
    try {
        const pinned = await togglePinnedMessage(currentOrder.id, message.id, ADMIN_ACTOR);
        exitSelectionMode();
        showToast(pinned ? "تم تثبيت الرسالة" : "تم إلغاء تثبيت الرسالة");
    } catch (error) {
        console.error(error);
        showToast("تعذر تثبيت الرسالة");
    }
});

document.getElementById("adminSelectionDeleteMe").addEventListener("click", async () => {
    if (!currentOrder) return;
    const messages = getSelectedMessages();
    if (!messages.length) return;
    const accepted = await requestAdminConfirmation({
        title: "حذف الرسائل المحددة لدي",
        message: `ستختفي ${messages.length.toLocaleString("ar")} من الرسائل المحددة من صفحة الإدارة فقط.`,
        acceptText: "حذف لدي"
    });
    if (!accepted) return;
    try {
        await deleteMessagesForMe(currentOrder.id, messages.map(message => message.id), ADMIN_ACTOR);
        exitSelectionMode();
        showToast("تم حذف الرسائل المحددة لديك");
    } catch (error) {
        console.error(error);
        showToast("تعذر حذف الرسائل");
    }
});

selectionDeleteAll.addEventListener("click", async () => {
    if (!currentOrder) return;
    const messages = getSelectedMessages().filter(message =>
        message.senderId === ADMIN_ACTOR && !message.deletedForAll
    );
    if (!messages.length || messages.length !== selectedMessageIds.size) return;
    const accepted = await requestAdminConfirmation({
        title: "حذف الرسائل المحددة لدى الجميع",
        message: `سيتم حذف ${messages.length.toLocaleString("ar")} من رسائل الإدارة لدى الطرفين.`,
        acceptText: "حذف لدى الجميع"
    });
    if (!accepted) return;
    try {
        await deleteMessagesForEveryone(currentOrder.id, messages.map(message => message.id), ADMIN_ACTOR);
        exitSelectionMode();
        showToast("تم حذف الرسائل لدى الجميع");
    } catch (error) {
        console.error(error);
        showToast("تعذر حذف الرسائل");
    }
});

document.getElementById("adminPinnedMessageJump").addEventListener("click", () => {
    scrollToMessage(pinnedMessageBar.dataset.messageId || "");
});

document.getElementById("adminUnpinMessage").addEventListener("click", async () => {
    if (!currentOrder) return;
    const messageId = pinnedMessageBar.dataset.messageId || "";
    if (!messageId) return;
    try {
        await togglePinnedMessage(currentOrder.id, messageId, ADMIN_ACTOR);
        showToast("تم إلغاء تثبيت الرسالة");
    } catch (error) {
        console.error(error);
        showToast("تعذر إلغاء التثبيت");
    }
});

document.getElementById("adminCancelConfirm").addEventListener("click", () => settleAdminConfirmation(false));
confirmAccept.addEventListener("click", () => settleAdminConfirmation(true));
confirmModal.addEventListener("click", event => {
    if (event.target === confirmModal) settleAdminConfirmation(false);
});

document.getElementById("adminMobileBack").addEventListener("click", async () => {
    voiceRecorder?.cancel();
    exitSelectionMode(false);
    adminChatApp.classList.remove("conversation-open");
    if (window.innerWidth > 720 && currentOrder) {
        await setChatPresence(currentOrder.id, ADMIN_ACTOR, false);
        currentOrder = null;
        adminChatTop.hidden = true;
        adminMessagesArea.hidden = true;
        adminComposerZone.hidden = true;
        adminEmpty.hidden = false;
        renderConversationList();
    }
});

conversationSearch.addEventListener("input", renderConversationList);

messageForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentOrder) return;
    if (!messageInput.value.trim()) {
        emojiPanel.hidden = true;
        await voiceRecorder?.start();
        return;
    }
    const text = messageInput.value;
    const orderId = currentOrder.id;
    messageInput.value = "";
    resizeInput();
    updateComposerAction();
    sendButton.disabled = true;
    try {
        const sentMessage = await sendChatMessage(orderId, ADMIN_ACTOR, text, replyTarget, null, message => {
            optimisticMessages.set(message.id, message);
            renderCurrentConversation();
        });
        sendPushForMessage({
            orderId,
            senderId: ADMIN_ACTOR,
            messageId: sentMessage.id
        }).catch(error => console.warn("Push send failed", error));
        clearReply();
        emojiPanel.hidden = true;
    } catch (error) {
        console.error(error);
        for (const [id, message] of optimisticMessages) {
            if (message.senderId === ADMIN_ACTOR && message.text === text) optimisticMessages.delete(id);
        }
        if (currentOrder) renderCurrentConversation();
        messageInput.value = text;
        resizeInput();
        updateComposerAction();
        showToast("تعذر إرسال الرسالة");
    } finally {
        sendButton.disabled = false;
    }
});

messageInput.addEventListener("input", () => {
    resizeInput();
    updateComposerAction();
    if (!currentOrder) return;
    setChatTyping(currentOrder.id, ADMIN_ACTOR, Boolean(messageInput.value.trim()));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setChatTyping(currentOrder.id, ADMIN_ACTOR, false), 1300);
});

messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        messageForm.requestSubmit();
    }
});

document.getElementById("adminEmojiButton").addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
    attachmentSheet.hidden = true;
});
document.getElementById("adminAttachmentButton").addEventListener("click", event => {
    event.stopPropagation();
    attachmentSheet.hidden = !attachmentSheet.hidden;
    emojiPanel.hidden = true;
});
cameraButton.addEventListener("click", () => cameraInput.click());
attachmentSheet.addEventListener("click", event => {
    const choice = event.target.closest("button[data-attachment]")?.dataset.attachment;
    if (!choice) return;
    attachmentSheet.hidden = true;
    if (choice === "camera") cameraInput.click();
    else {
        mediaInput.accept = choice === "gallery"
            ? "image/*,video/*"
            : ".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,application/pdf,text/plain";
        mediaInput.click();
    }
});
mediaInput.addEventListener("change", async () => {
    await sendSelectedMedia(mediaInput.files);
    mediaInput.value = "";
});
cameraInput.addEventListener("change", async () => {
    await sendSelectedMedia(cameraInput.files);
    cameraInput.value = "";
});
document.getElementById("adminCancelReply").addEventListener("click", clearReply);

messageMenu.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (button) handleMenuAction(button.dataset.action);
});
document.addEventListener("click", event => {
    const justOpenedByLongPress = Date.now() - messageMenuOpenedAt < 450;
    if (!messageMenu.hidden && !messageMenu.contains(event.target) && !justOpenedByLongPress) closeMessageMenu();
    if (!attachmentSheet.hidden && !attachmentSheet.contains(event.target) && !event.target.closest("#adminAttachmentButton")) {
        attachmentSheet.hidden = true;
    }
});
document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!confirmModal.hidden) settleAdminConfirmation(false);
    else if (!infoModal.hidden) closeInfo();
    else if (!messageMenu.hidden) closeMessageMenu();
    else if (selectionMode) exitSelectionMode();
});
document.getElementById("adminCloseInfo").addEventListener("click", closeInfo);
document.getElementById("adminCloseInfoAction").addEventListener("click", closeInfo);
infoModal.addEventListener("click", event => { if (event.target === infoModal) closeInfo(); });

document.addEventListener("visibilitychange", () => {
    if (!currentOrder) return;
    setChatPresence(currentOrder.id, ADMIN_ACTOR, document.visibilityState === "visible");
    acknowledgeIncomingMessages(currentOrder);
});
window.addEventListener("focus", () => {
    if (currentOrder) acknowledgeIncomingMessages(currentOrder);
    if (!adminChatApp.hidden && "Notification" in window && Notification.permission === "granted" &&
        !adminNotificationsOptedOut() && !adminPushToken) {
        enableAdminPush({ quiet: true });
    } else {
        renderAdminNotificationButton();
    }
});
window.addEventListener("pagehide", () => {
    if (currentOrder) setChatPresence(currentOrder.id, ADMIN_ACTOR, false);
});

voiceRecorder = createVoiceRecorder({
    panel: voiceRecorderPanel,
    composer: messageForm,
    timer: voiceRecordingTimer,
    pauseButton: pauseVoiceRecording,
    cancelButton: cancelVoiceRecording,
    sendButton: sendVoiceRecording,
    triggerButton: sendButton,
    isVoiceMode: () => !messageInput.value.trim(),
    onStart: () => {
        emojiPanel.hidden = true;
        attachmentSheet.hidden = true;
    },
    onSend: sendRecordedVoice,
    onNotify: showToast
});
updateComposerAction();
buildEmojiPanel();
renderAdminNotificationButton();
if (localStorage.getItem("adminLogin") === "yes") unlockAdmin();
