import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    db,
    ADMIN_ACTOR,
    CLIENT_ACTOR,
    sortMessages,
    formatMessageTime,
    formatMessageDate,
    sendChatMessage,
    createPendingAudioMessage,
    markChatAudioFailed,
    createPendingMediaMessage,
    markChatMediaFailed,
    markMessagesRead,
    toggleMessageStar,
    deleteMessageForMe,
    deleteMessageForEveryone,
    registerChatPushToken,
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
    createMediaMessageContent
} from "./chat-media.js";

const ADMIN_PASSWORD = "232167";
const ADMIN_INSTALL_KEY = "waleed_admin_chat_app_installed";
const EMOJIS = ["😀","😊","😂","😍","🥰","😄","😢","😭","😮","😔","👍","👎","👏","🙏","🤲","❤️","💚","💙","✨","🎉","✅","📌","📄","📞","🏦","🇸🇦","🌹","💬","🤝","🌟","💯"];

const adminLock = document.getElementById("adminLock");
const adminChatApp = document.getElementById("adminChatApp");
const loginForm = document.getElementById("adminLoginForm");
const adminPassword = document.getElementById("adminPassword");
const loginError = document.getElementById("adminLoginError");
const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const conversationCount = document.getElementById("conversationCount");
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
const toast = document.getElementById("adminToast");
const installAdminChatAppButton = document.getElementById("installAdminChatAppButton");

let allConversations = [];
let currentOrder = null;
let unsubscribeOrders = null;
let replyTarget = null;
let activeMessage = null;
let initialSnapshotLoaded = false;
let knownClientMessageIds = new Set();
let toastTimer = null;
let typingTimer = null;
let longPressTimer = null;
let markReadTimer = null;
let messageSearchQuery = "";
let starredOnly = false;
let adminPushToken = "";
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

async function registerAdminTokenForConversations(token) {
    if (!token || adminTokenRegistrationRunning) return;
    adminTokenRegistrationRunning = true;
    try {
        const pending = allConversations.filter(order => !orderHasPushToken(order, token));
        for (let index = 0; index < pending.length; index += 5) {
            const group = pending.slice(index, index + 5);
            await Promise.allSettled(group.map(order =>
                registerChatPushToken(order.id, ADMIN_ACTOR, token)
            ));
        }
    } finally {
        adminTokenRegistrationRunning = false;
    }
}

async function enableAdminPush({ requestPermission = false, quiet = false } = {}) {
    try {
        const token = await getBrowserPushToken({ requestPermission });
        if (!token) {
            if (!quiet && requestPermission) showToast("لم يتم السماح بالإشعارات");
            return null;
        }
        adminPushToken = token;
        await registerAdminTokenForConversations(token);
        if (!quiet) showToast("تم تفعيل إشعارات الإدارة");
        return token;
    } catch (error) {
        console.error("Admin push registration failed", error);
        if (!quiet) showToast("تعذر تفعيل الإشعارات الآن");
        return null;
    }
}

function unlockAdmin() {
    adminLock.hidden = true;
    adminChatApp.hidden = false;
    if (!unsubscribeOrders) listenToConversations();
    if ("Notification" in window && Notification.permission === "granted") {
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

function listenToConversations() {
    unsubscribeOrders = onSnapshot(collection(db, "orders"), snapshot => {
        const orders = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .filter(order => order.chatEnabled === true || (Array.isArray(order.chatMessages) && order.chatMessages.length))
            .sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));

        const clientMessages = orders.flatMap(order =>
            sortMessages(order.chatMessages)
                .filter(message => message.senderId === CLIENT_ACTOR)
                .map(message => ({ ...message, order }))
        );
        const newMessages = clientMessages.filter(message => !knownClientMessageIds.has(message.id));

        allConversations = orders;
        renderConversationList();
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = `conversation-item${currentOrder?.id === order.id ? " active" : ""}`;

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
    await markMessagesRead(order.id, ADMIN_ACTOR);
    messageInput.focus();
}

function messageRenderSignature(messages) {
    return JSON.stringify([
        currentOrder?.id,
        messageSearchQuery,
        starredOnly,
        messages.map(message => [
            message.id,
            message.text,
            message.messageType,
            message.uploadStatus,
            message.mediaPath,
            message.audioUrl,
            message.media?.url,
            message.media?.path,
            message.deletedForAll,
            message.replyTo?.id,
            message.readBy,
            message.starredBy,
            message.deletedFor
        ])
    ]);
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
    const allMessages = sortMessages(currentOrder.chatMessages)
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

    clearTimeout(markReadTimer);
    markReadTimer = setTimeout(() => markMessagesRead(currentOrder.id, ADMIN_ACTOR).catch(console.error), 250);
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
    row.className = `message-row ${mine ? "mine" : "theirs"}`;
    const bubble = document.createElement("article");
    bubble.className = "message-bubble";
    bubble.tabIndex = 0;

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
    if (!isAudio && !isMedia) content.appendChild(document.createTextNode(message.text || ""));

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("span");
    time.textContent = formatMessageTime(message.clientTime);
    meta.appendChild(time);
    if (mine) {
        const read = Array.isArray(message.readBy) && message.readBy.includes(CLIENT_ACTOR);
        const checks = document.createElement("span");
        checks.className = `message-checks${read ? " read" : ""}`;
        checks.textContent = read ? "✓✓" : "✓";
        meta.appendChild(checks);
    }
    bubble.append(content, meta);

    bubble.addEventListener("contextmenu", event => openMessageMenu(event, message));
    bubble.addEventListener("dblclick", event => openMessageMenu(event, message));
    bubble.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse") return;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => openMessageMenu(event, message), 560);
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
    messageMenu.hidden = false;
    const x = Math.min(event.clientX || window.innerWidth / 2, window.innerWidth - 220);
    const y = Math.min(event.clientY || window.innerHeight / 2, window.innerHeight - 300);
    messageMenu.style.left = `${Math.max(8, x)}px`;
    messageMenu.style.top = `${Math.max(8, y)}px`;
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

async function sendSelectedMedia(files) {
    if (!currentOrder || !files?.length) return;
    attachmentSheet.hidden = true;
    const selected = [...files].slice(0, 5);
    if (files.length > 5) showToast("يمكن إرسال 5 ملفات في المرة الواحدة");

    for (const file of selected) {
        if (file.size > 25 * 1024 * 1024) {
            showToast(`الملف ${file.name} أكبر من 25 ميجابايت`);
            continue;
        }
        const orderId = currentOrder.id;
        const pending = await createPendingMediaMessage(orderId, ADMIN_ACTOR, file, replyTarget);
        try {
            await uploadChatMedia({
                orderId,
                senderId: ADMIN_ACTOR,
                messageId: pending.id,
                file
            });
            clearReply();
            sendPushForMessage({
                orderId,
                senderId: ADMIN_ACTOR,
                messageId: pending.id
            }).catch(error => console.warn("Media push send failed", error));
        } catch (error) {
            console.error("Media send failed", error);
            await markChatMediaFailed(orderId, pending.id).catch(console.error);
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
        if (action === "star") await toggleMessageStar(currentOrder.id, message.id, ADMIN_ACTOR);
        if (action === "delete-me") await deleteMessageForMe(currentOrder.id, message.id, ADMIN_ACTOR);
        if (action === "delete-all" && confirm("حذف الرسالة لدى الجميع؟")) {
            await deleteMessageForEveryone(currentOrder.id, message.id, ADMIN_ACTOR);
        }
        if (action === "info") showMessageInfo(message);
    } catch (error) {
        console.error(error);
        showToast("تعذر تنفيذ العملية");
    }
}

function showMessageInfo(message) {
    const read = Array.isArray(message.readBy) && message.readBy.includes(CLIENT_ACTOR);
    infoBody.textContent = "";
    [
        `المرسل: ${message.senderName || "غير محدد"}`,
        `وقت الإرسال: ${new Date(message.clientTime).toLocaleString("ar-SA")}`,
        `حالة الرسالة: ${read ? "تمت القراءة" : "تم الإرسال"}`,
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
            icon: "../icons/icon-192.png"
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

document.getElementById("adminNotificationButton").addEventListener("click", async () => {
    await enableAdminPush({ requestPermission: true });
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

document.getElementById("adminMobileBack").addEventListener("click", async () => {
    voiceRecorder?.cancel();
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
        const sentMessage = await sendChatMessage(orderId, ADMIN_ACTOR, text, replyTarget);
        sendPushForMessage({
            orderId,
            senderId: ADMIN_ACTOR,
            messageId: sentMessage.id
        }).catch(error => console.warn("Push send failed", error));
        clearReply();
        emojiPanel.hidden = true;
    } catch (error) {
        console.error(error);
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
    if (!messageMenu.hidden && !messageMenu.contains(event.target)) closeMessageMenu();
    if (!attachmentSheet.hidden && !attachmentSheet.contains(event.target) && !event.target.closest("#adminAttachmentButton")) {
        attachmentSheet.hidden = true;
    }
});
document.getElementById("adminCloseInfo").addEventListener("click", closeInfo);
document.getElementById("adminCloseInfoAction").addEventListener("click", closeInfo);
infoModal.addEventListener("click", event => { if (event.target === infoModal) closeInfo(); });

document.addEventListener("visibilitychange", () => {
    if (!currentOrder) return;
    setChatPresence(currentOrder.id, ADMIN_ACTOR, document.visibilityState === "visible");
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
if (localStorage.getItem("adminLogin") === "yes") unlockAdmin();
