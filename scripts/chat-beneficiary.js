import {
    CLIENT_ACTOR,
    ADMIN_ACTOR,
    normalizePhone,
    normalizeTransaction,
    findOrderByCredentials,
    ensureChatInitialized,
    subscribeToOrder,
    sortMessages,
    formatMessageTime,
    formatMessageDate,
    sendChatMessage,
    markMessagesRead,
    toggleMessageStar,
    deleteMessageForMe,
    deleteMessageForEveryone,
    setChatPresence,
    setChatTyping
} from "./chat-core.js";

const SESSION_KEY = "waleed_internal_chat_session";
const EMOJIS = ["😀","😊","😂","😍","🥰","😄","😢","😭","😮","😔","👍","👎","👏","🙏","🤲","❤️","💚","💙","✨","🎉","✅","📌","📄","📞","🏦","🇸🇦","🌹","💬","🤝","🌟","💯"];

const loginView = document.getElementById("loginView");
const chatView = document.getElementById("chatView");
const loginForm = document.getElementById("chatLoginForm");
const transactionInput = document.getElementById("transactionInput");
const phoneInput = document.getElementById("phoneInput");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const messagesArea = document.getElementById("messagesArea");
const messagesList = document.getElementById("messagesList");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const emojiPanel = document.getElementById("emojiPanel");
const replyPreview = document.getElementById("replyPreview");
const replySender = document.getElementById("replySender");
const replyText = document.getElementById("replyText");
const typingBar = document.getElementById("typingBar");
const adminStatus = document.getElementById("adminStatus");
const chatOrderBadge = document.getElementById("chatOrderBadge");
const messageSearchBar = document.getElementById("messageSearchBar");
const messageSearchInput = document.getElementById("messageSearchInput");
const messageSearchCount = document.getElementById("messageSearchCount");
const starredMessagesButton = document.getElementById("starredMessagesButton");
const messageMenu = document.getElementById("messageMenu");
const infoModal = document.getElementById("messageInfoModal");
const infoBody = document.getElementById("messageInfoBody");
const toast = document.getElementById("toast");

let currentOrder = null;
let unsubscribe = null;
let activeMessage = null;
let replyTarget = null;
let initializedMessages = false;
let knownMessageIds = new Set();
let typingTimer = null;
let toastTimer = null;
let markReadTimer = null;
let longPressTimer = null;
let messageSearchQuery = "";
let starredOnly = false;

function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function loadSession() {
    try {
        const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
        return value && value.orderId && value.transactionId && value.phone ? value : null;
    } catch {
        return null;
    }
}

function saveSession(value) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function setWhatsappLinks(transactionId) {
    const message = `السلام عليكم، أحتاج المساعدة بخصوص المعاملة رقم ${transactionId}`;
    const url = `https://wa.me/966580272758?text=${encodeURIComponent(message)}`;
    document.getElementById("floatingWhatsapp").href = url;
}

async function startChat(session) {
    if (unsubscribe) unsubscribe();
    try {
        await ensureChatInitialized(session.orderId);
    } catch (error) {
        console.error(error);
        clearSession();
        loginError.textContent = "تعذر فتح المحادثة. تحقق من بيانات المعاملة.";
        loginView.hidden = false;
        chatView.hidden = true;
        return;
    }

    currentOrder = { id: session.orderId, transactionId: session.transactionId, phone: session.phone };
    setWhatsappLinks(session.transactionId);
    chatOrderBadge.textContent = `#${session.transactionId}`;
    messageSearchQuery = "";
    messageSearchInput.value = "";
    messageSearchBar.hidden = true;
    starredOnly = false;
    starredMessagesButton.classList.remove("active");
    starredMessagesButton.textContent = "☆";
    loginView.hidden = true;
    chatView.hidden = false;
    initializedMessages = false;
    knownMessageIds = new Set();

    const draftKey = `waleed_chat_draft_${session.orderId}`;
    messageInput.value = localStorage.getItem(draftKey) || "";
    resizeInput();

    await setChatPresence(session.orderId, CLIENT_ACTOR, true);
    unsubscribe = subscribeToOrder(session.orderId, order => {
        currentOrder = order;
        renderOrder(order);
    }, error => {
        console.error(error);
        showToast("تعذر الاتصال بالمحادثة");
    });
}

function renderOrder(order) {
    const allMessages = sortMessages(order.chatMessages)
        .filter(message => !(Array.isArray(message.deletedFor) && message.deletedFor.includes(CLIENT_ACTOR)));

    const newAdminMessages = allMessages.filter(message =>
        message.senderId === ADMIN_ACTOR && !knownMessageIds.has(message.id)
    );

    const query = messageSearchQuery.trim().toLowerCase();
    const messages = allMessages.filter(message => {
        const matchesSearch = !query || String(message.text || "").toLowerCase().includes(query);
        const matchesStar = !starredOnly || (Array.isArray(message.starredBy) && message.starredBy.includes(CLIENT_ACTOR));
        return matchesSearch && matchesStar;
    });
    messageSearchCount.textContent = query || starredOnly ? `${messages.length} نتيجة` : "";
    chatOrderBadge.textContent = `#${order.transactionId || currentOrder?.transactionId || "----"}`;

    renderMessages(messages);
    updateAdminStatus(order);
    typingBar.hidden = order.chatTyping?.admin !== true;

    if (initializedMessages && newAdminMessages.length) {
        const latest = newAdminMessages[newAdminMessages.length - 1];
        notifyNewMessage(latest.text);
    }

    knownMessageIds = new Set(allMessages.map(message => message.id));
    initializedMessages = true;
    clearTimeout(markReadTimer);
    markReadTimer = setTimeout(() => {
        markMessagesRead(order.id, CLIENT_ACTOR).catch(console.error);
    }, 250);
}

function updateAdminStatus(order) {
    if (order.chatTyping?.admin === true) {
        adminStatus.textContent = "الإدارة تكتب الآن...";
        adminStatus.className = "typing-text";
        return;
    }
    if (order.chatOnline?.admin === true) {
        adminStatus.textContent = "● متصل الآن";
        adminStatus.className = "online-dot";
        return;
    }
    const lastSeen = order.chatLastSeen?.admin;
    if (lastSeen) {
        const date = typeof lastSeen.toDate === "function" ? lastSeen.toDate() : new Date(lastSeen);
        adminStatus.textContent = `آخر ظهور ${date.toLocaleString("ar-SA", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
    } else {
        adminStatus.textContent = "متاح للمراسلة";
    }
    adminStatus.className = "";
}

function renderMessages(messages) {
    const wasNearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 130;
    messagesList.textContent = "";

    if (!messages.length) {
        const empty = document.createElement("div");
        empty.className = "empty-chat";
        empty.textContent = messageSearchQuery || starredOnly
            ? "لا توجد رسائل مطابقة."
            : "ابدأ محادثتك مع الإدارة.";
        messagesList.appendChild(empty);
        return;
    }

    let activeDate = "";
    const fragment = document.createDocumentFragment();
    messages.forEach(message => {
        const messageDate = formatMessageDate(message.clientTime);
        if (messageDate && messageDate !== activeDate) {
            activeDate = messageDate;
            const divider = document.createElement("div");
            divider.className = "day-divider";
            divider.textContent = messageDate;
            fragment.appendChild(divider);
        }
        fragment.appendChild(createMessageElement(message));
    });
    messagesList.appendChild(fragment);

    if (wasNearBottom || !initializedMessages) {
        requestAnimationFrame(() => { messagesArea.scrollTop = messagesArea.scrollHeight; });
    }
}

function createMessageElement(message) {
    const mine = message.senderId === CLIENT_ACTOR;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : "theirs"}`;

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

    const text = document.createElement("div");
    text.className = `message-text${message.deletedForAll ? " deleted" : ""}`;
    if (Array.isArray(message.starredBy) && message.starredBy.includes(CLIENT_ACTOR)) {
        const star = document.createElement("span");
        star.className = "message-star";
        star.textContent = "★";
        text.appendChild(star);
    }
    text.appendChild(document.createTextNode(message.text || ""));

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("span");
    time.textContent = formatMessageTime(message.clientTime);
    meta.appendChild(time);
    if (mine) {
        const checks = document.createElement("span");
        const isRead = Array.isArray(message.readBy) && message.readBy.includes(ADMIN_ACTOR);
        checks.className = `message-checks${isRead ? " read" : ""}`;
        checks.textContent = isRead ? "✓✓" : "✓";
        meta.appendChild(checks);
    }

    bubble.append(text, meta);
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
    const deleteAllButton = messageMenu.querySelector('[data-action="delete-all"]');
    deleteAllButton.hidden = message.senderId !== CLIENT_ACTOR || message.deletedForAll;
    const starButton = messageMenu.querySelector('[data-action="star"]');
    const starred = Array.isArray(message.starredBy) && message.starredBy.includes(CLIENT_ACTOR);
    starButton.textContent = starred ? "☆ إزالة النجمة" : "⭐ تمييز بنجمة";

    messageMenu.hidden = false;
    const x = Math.min(event.clientX || window.innerWidth / 2, window.innerWidth - 220);
    const y = Math.min(event.clientY || window.innerHeight / 2, window.innerHeight - 300);
    messageMenu.style.left = `${Math.max(8, x)}px`;
    messageMenu.style.top = `${Math.max(8, y)}px`;
}

function closeMessageMenu() {
    messageMenu.hidden = true;
}

function setReply(message) {
    replyTarget = message;
    replySender.textContent = message.senderName || (message.senderId === ADMIN_ACTOR ? "إدارة المؤسسة" : "المستفيد");
    replyText.textContent = message.text || "";
    replyPreview.hidden = false;
    messageInput.focus();
}

function clearReply() {
    replyTarget = null;
    replyPreview.hidden = true;
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
            messageInput.focus();
        }
        if (action === "star") {
            await toggleMessageStar(currentOrder.id, message.id, CLIENT_ACTOR);
            showToast("تم تحديث النجمة");
        }
        if (action === "delete-me") {
            await deleteMessageForMe(currentOrder.id, message.id, CLIENT_ACTOR);
            showToast("تم حذف الرسالة لديك");
        }
        if (action === "delete-all") {
            if (confirm("حذف الرسالة لدى الجميع؟")) {
                await deleteMessageForEveryone(currentOrder.id, message.id, CLIENT_ACTOR);
            }
        }
        if (action === "info") showMessageInfo(message);
    } catch (error) {
        console.error(error);
        showToast("تعذر تنفيذ العملية");
    }
}

function showMessageInfo(message) {
    const read = Array.isArray(message.readBy) && message.readBy.includes(ADMIN_ACTOR);
    infoBody.textContent = "";
    const lines = [
        `المرسل: ${message.senderName || "غير محدد"}`,
        `وقت الإرسال: ${new Date(message.clientTime).toLocaleString("ar-SA")}`,
        `حالة الرسالة: ${read ? "تمت القراءة" : "تم الإرسال"}`,
        `معرّف الرسالة: ${message.id}`
    ];
    lines.forEach(line => {
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
            const end = messageInput.selectionEnd;
            messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
            messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
            messageInput.focus();
            resizeInput();
        });
        fragment.appendChild(button);
    });
    emojiPanel.appendChild(fragment);
}

function notifyNewMessage(text) {
    playChime();
    showToast(`🔔 رسالة جديدة من الإدارة: ${String(text || "").slice(0, 80)}`);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("رسالة جديدة من إدارة المؤسسة", {
            body: String(text || "رسالة جديدة").slice(0, 150),
            icon: "../icons/icon-192.png"
        });
    }
}

function playChime() {
    try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 720;
        gain.gain.setValueAtTime(.07, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + .18);
    } catch { /* الصوت اختياري */ }
}

loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.textContent = "جاري التحقق...";
    try {
        const transactionId = normalizeTransaction(transactionInput.value);
        const phone = normalizePhone(phoneInput.value);
        const order = await findOrderByCredentials(transactionId, phone);
        if (!order) throw new Error("invalid-credentials");
        const session = { orderId: order.id, transactionId, phone, name: order.data.name || "المستفيد" };
        saveSession(session);
        await startChat(session);
    } catch (error) {
        console.error(error);
        loginError.textContent = "رقم المعاملة أو رقم الجوال غير صحيح.";
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = "💬 دخول إلى المحادثة";
    }
});

messageForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentOrder || !messageInput.value.trim()) return;
    const text = messageInput.value;
    messageInput.value = "";
    resizeInput();
    sendButton.disabled = true;
    try {
        await sendChatMessage(currentOrder.id, CLIENT_ACTOR, text, replyTarget);
        localStorage.removeItem(`waleed_chat_draft_${currentOrder.id}`);
        clearReply();
        emojiPanel.hidden = true;
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
        }
    } catch (error) {
        console.error(error);
        messageInput.value = text;
        resizeInput();
        showToast("تعذر إرسال الرسالة");
    } finally {
        sendButton.disabled = false;
    }
});

messageInput.addEventListener("input", () => {
    resizeInput();
    if (!currentOrder) return;
    localStorage.setItem(`waleed_chat_draft_${currentOrder.id}`, messageInput.value);
    setChatTyping(currentOrder.id, CLIENT_ACTOR, Boolean(messageInput.value.trim()));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setChatTyping(currentOrder.id, CLIENT_ACTOR, false), 1300);
});

messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        messageForm.requestSubmit();
    }
});

document.getElementById("emojiButton").addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
});
document.getElementById("attachmentButton").addEventListener("click", () => {
    showToast("سيتم تفعيل الصور والملفات بعد إعداد Firebase Storage");
});
document.getElementById("cancelReplyButton").addEventListener("click", clearReply);

document.getElementById("logoutButton").addEventListener("click", async () => {
    if (!confirm("هل تريد تسجيل الخروج من المحادثة؟")) return;
    if (currentOrder) await setChatPresence(currentOrder.id, CLIENT_ACTOR, false);
    if (unsubscribe) unsubscribe();
    clearSession();
    currentOrder = null;
    chatView.hidden = true;
    loginView.hidden = false;
    messagesList.textContent = "";
});

document.getElementById("chatBackButton").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = "../index.html";
});

document.getElementById("messageSearchButton").addEventListener("click", () => {
    messageSearchBar.hidden = !messageSearchBar.hidden;
    if (!messageSearchBar.hidden) messageSearchInput.focus();
});

document.getElementById("closeMessageSearch").addEventListener("click", () => {
    messageSearchBar.hidden = true;
    messageSearchInput.value = "";
    messageSearchQuery = "";
    if (currentOrder) renderOrder(currentOrder);
});

messageSearchInput.addEventListener("input", () => {
    messageSearchQuery = messageSearchInput.value;
    if (currentOrder) renderOrder(currentOrder);
});

starredMessagesButton.addEventListener("click", () => {
    starredOnly = !starredOnly;
    starredMessagesButton.classList.toggle("active", starredOnly);
    starredMessagesButton.textContent = starredOnly ? "★" : "☆";
    if (currentOrder) renderOrder(currentOrder);
});

messageMenu.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (button) handleMenuAction(button.dataset.action);
});

document.addEventListener("click", event => {
    if (!messageMenu.hidden && !messageMenu.contains(event.target)) closeMessageMenu();
});

document.getElementById("closeInfoButton").addEventListener("click", closeInfo);
document.getElementById("closeInfoAction").addEventListener("click", closeInfo);
infoModal.addEventListener("click", event => { if (event.target === infoModal) closeInfo(); });

document.addEventListener("visibilitychange", () => {
    if (!currentOrder) return;
    setChatPresence(currentOrder.id, CLIENT_ACTOR, document.visibilityState === "visible");
});
window.addEventListener("pagehide", () => {
    if (currentOrder) setChatPresence(currentOrder.id, CLIENT_ACTOR, false);
});

buildEmojiPanel();
const session = loadSession();
if (session) {
    transactionInput.value = session.transactionId;
    phoneInput.value = session.phone;
    startChat(session);
}
