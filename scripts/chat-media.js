const mediaUrlCache = new Map();
const mediaUrlPending = new Map();

export function formatMediaSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function resolveMessageMediaUrl(orderId, messageId) {
    const key = `${orderId}:${messageId}`;
    const cached = mediaUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
    if (mediaUrlPending.has(key)) return mediaUrlPending.get(key);

    const request = (async () => {
        const response = await fetch("/api/chat-media-url", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ orderId, messageId })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) throw new Error(result.error || "media-url-failed");
        const lifetime = Number(result.expiresIn) > 0 ? Number(result.expiresIn) * 1000 : 24 * 60 * 60 * 1000;
        mediaUrlCache.set(key, { url: result.url, expiresAt: Date.now() + lifetime });
        return result.url;
    })();
    mediaUrlPending.set(key, request);
    try {
        return await request;
    } finally {
        mediaUrlPending.delete(key);
    }
}

export async function uploadChatMedia({ orderId, senderId, messageId, file }) {
    const prepareResponse = await fetch("/api/prepare-chat-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            orderId,
            senderId,
            messageId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size
        })
    });
    const prepared = await prepareResponse.json().catch(() => ({}));
    if (!prepareResponse.ok || !prepared.upload) {
        throw new Error(prepared.error || "media-prepare-failed");
    }

    const upload = prepared.upload;
    const formData = new FormData();
    formData.append("cacheControl", "3600");
    formData.append("", file);
    const uploadResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "X-Upsert": "false" },
        body: formData
    });
    if (!uploadResponse.ok) throw new Error("media-upload-failed");

    const finalizeResponse = await fetch("/api/finalize-chat-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId, senderId, messageId })
    });
    const finalized = await finalizeResponse.json().catch(() => ({}));
    if (!finalizeResponse.ok) throw new Error(finalized.error || "media-finalize-failed");
    return finalized;
}

function pendingView(message) {
    const pending = document.createElement("div");
    pending.className = "media-message-status";
    if (message.uploadStatus === "failed") {
        pending.classList.add("failed");
        pending.textContent = "⚠ تعذر إرسال المرفق";
        return pending;
    }
    const spinner = document.createElement("span");
    spinner.className = "voice-upload-spinner";
    const label = document.createElement("span");
    label.textContent = message.messageType === "image" ? "جارٍ إرسال الصورة..."
        : message.messageType === "video" ? "جارٍ إرسال الفيديو..."
            : "جارٍ إرسال الملف...";
    pending.append(spinner, label);
    return pending;
}

export function createMediaMessageContent(message, orderId) {
    const legacyMedia = message.media && typeof message.media === "object" ? message.media : {};
    const legacyUrl = typeof legacyMedia.url === "string" && legacyMedia.url.startsWith("https://")
        ? legacyMedia.url
        : "";
    const legacyPath = typeof legacyMedia.path === "string" ? legacyMedia.path : "";
    const isReady = (message.uploadStatus === "ready" && Boolean(message.mediaPath)) || Boolean(legacyUrl || legacyPath);
    if (!isReady) return pendingView(message);

    const mediaUrl = () => legacyPath || message.mediaPath
        ? resolveMessageMediaUrl(orderId, message.id)
        : Promise.resolve(legacyUrl);
    const mediaName = message.mediaName || legacyMedia.name || "مرفق";
    const mediaBytes = message.mediaBytes || legacyMedia.size || 0;
    const wrapper = document.createElement("div");
    wrapper.className = `media-message-content ${message.messageType}`;

    if (message.messageType === "image") {
        const originalLink = document.createElement("a");
        originalLink.className = "media-preview-link image-preview-link";
        originalLink.target = "_blank";
        originalLink.rel = "noopener noreferrer";
        originalLink.setAttribute("aria-label", "فتح الصورة الأصلية");
        originalLink.hidden = true;
        const image = document.createElement("img");
        image.alt = mediaName || "صورة مرفقة";
        image.loading = "lazy";
        image.decoding = "async";
        const badge = document.createElement("span");
        badge.className = "media-open-badge";
        badge.textContent = "↗ عرض الأصل";
        const loading = pendingView({ ...message, uploadStatus: "pending", messageType: "image" });
        originalLink.append(image, badge);
        wrapper.append(loading, originalLink);
        image.addEventListener("load", () => {
            originalLink.hidden = false;
            loading.remove();
        }, { once: true });
        mediaUrl().then(url => {
            originalLink.href = url;
            image.src = url;
        }).catch(() => {
            loading.classList.add("failed");
            loading.textContent = "تعذر تحميل الصورة";
        });
        originalLink.addEventListener("click", event => event.stopPropagation());
        return wrapper;
    }

    if (message.messageType === "video") {
        const originalLink = document.createElement("a");
        originalLink.className = "media-preview-link video-preview-link";
        originalLink.target = "_blank";
        originalLink.rel = "noopener noreferrer";
        originalLink.setAttribute("aria-label", "فتح الفيديو الأصلي");
        originalLink.hidden = true;
        const video = document.createElement("video");
        video.preload = "metadata";
        video.playsInline = true;
        video.muted = true;
        const badge = document.createElement("span");
        badge.className = "media-open-badge video-badge";
        badge.textContent = "▶ فتح الفيديو";
        const loading = pendingView({ ...message, uploadStatus: "pending", messageType: "video" });
        originalLink.append(video, badge);
        wrapper.append(loading, originalLink);
        mediaUrl().then(url => {
            originalLink.href = url;
            video.src = url;
            originalLink.hidden = false;
            loading.remove();
        }).catch(() => {
            loading.classList.add("failed");
            loading.textContent = "تعذر تحميل الفيديو";
        });
        originalLink.addEventListener("click", event => event.stopPropagation());
        return wrapper;
    }

    const fileButton = document.createElement("button");
    fileButton.type = "button";
    fileButton.className = "media-file-button";
    const icon = document.createElement("span");
    icon.className = "media-file-icon";
    icon.textContent = "▤";
    const details = document.createElement("span");
    details.className = "media-file-details";
    const name = document.createElement("strong");
    name.textContent = mediaName || "ملف مرفق";
    const size = document.createElement("small");
    size.textContent = formatMediaSize(mediaBytes);
    details.append(name, size);
    fileButton.append(icon, details);
    fileButton.addEventListener("click", async event => {
        event.stopPropagation();
        fileButton.disabled = true;
        try {
            const url = await mediaUrl();
            window.open(url, "_blank", "noopener");
        } finally {
            fileButton.disabled = false;
        }
    });
    wrapper.appendChild(fileButton);
    return wrapper;
}
