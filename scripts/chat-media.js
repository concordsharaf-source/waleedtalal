export function formatMediaSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function resolveMessageMediaUrl(orderId, messageId) {
    const response = await fetch("/api/chat-media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId, messageId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) throw new Error(result.error || "media-url-failed");
    return result.url;
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
    if (message.uploadStatus !== "ready" || !message.mediaPath) return pendingView(message);

    const wrapper = document.createElement("div");
    wrapper.className = `media-message-content ${message.messageType}`;

    if (message.messageType === "image") {
        const image = document.createElement("img");
        image.alt = message.mediaName || "صورة مرفقة";
        image.loading = "lazy";
        image.decoding = "async";
        const loading = pendingView({ ...message, uploadStatus: "pending", messageType: "image" });
        wrapper.append(loading, image);
        resolveMessageMediaUrl(orderId, message.id).then(url => {
            image.src = url;
            loading.remove();
        }).catch(() => {
            loading.classList.add("failed");
            loading.textContent = "تعذر تحميل الصورة";
        });
        image.addEventListener("click", async event => {
            event.stopPropagation();
            try { window.open(await resolveMessageMediaUrl(orderId, message.id), "_blank", "noopener"); } catch { /* لا شيء */ }
        });
        return wrapper;
    }

    if (message.messageType === "video") {
        const video = document.createElement("video");
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        const loading = pendingView({ ...message, uploadStatus: "pending", messageType: "video" });
        wrapper.append(loading, video);
        resolveMessageMediaUrl(orderId, message.id).then(url => {
            video.src = url;
            loading.remove();
        }).catch(() => {
            loading.classList.add("failed");
            loading.textContent = "تعذر تحميل الفيديو";
        });
        video.addEventListener("click", event => event.stopPropagation());
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
    name.textContent = message.mediaName || "ملف مرفق";
    const size = document.createElement("small");
    size.textContent = formatMediaSize(message.mediaBytes);
    details.append(name, size);
    fileButton.append(icon, details);
    fileButton.addEventListener("click", async event => {
        event.stopPropagation();
        fileButton.disabled = true;
        try {
            const url = await resolveMessageMediaUrl(orderId, message.id);
            window.open(url, "_blank", "noopener");
        } finally {
            fileButton.disabled = false;
        }
    });
    wrapper.appendChild(fileButton);
    return wrapper;
}
