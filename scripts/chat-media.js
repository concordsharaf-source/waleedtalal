const mediaUrlCache = new Map();
const mediaUrlPending = new Map();
const localMediaPreviewCache = new Map();

function canvasToBlob(canvas, type = "image/webp", quality = .72) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function createImageThumbnail(file, maxDimension = 640) {
    if (!String(file?.type || "").startsWith("image/")) return null;
    let source = null;
    let sourceUrl = "";
    try {
        if ("createImageBitmap" in window) {
            source = await createImageBitmap(file);
        } else {
            sourceUrl = URL.createObjectURL(file);
            source = new Image();
            source.decoding = "async";
            if (typeof source.decode === "function") {
                source.src = sourceUrl;
                await source.decode();
            } else {
                await new Promise((resolve, reject) => {
                    source.onload = resolve;
                    source.onerror = reject;
                    source.src = sourceUrl;
                });
            }
        }
        const sourceWidth = Math.max(1, Number(source.width || source.naturalWidth) || 1);
        const sourceHeight = Math.max(1, Number(source.height || source.naturalHeight) || 1);
        const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return null;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return await canvasToBlob(canvas, "image/webp", .72) || await canvasToBlob(canvas, "image/jpeg", .74);
    } finally {
        if (typeof source?.close === "function") source.close();
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    }
}

export function primeLocalMediaPreview(messageId, file) {
    const id = String(messageId || "");
    if (!id || !String(file?.type || "").startsWith("image/")) return null;
    const previous = localMediaPreviewCache.get(id);
    if (previous) return previous;

    const entry = {
        originalUrl: URL.createObjectURL(file),
        previewUrl: "",
        previewBlob: null,
        ready: null,
        cleanupTimer: null
    };
    entry.ready = createImageThumbnail(file).then(blob => {
        if (!blob || localMediaPreviewCache.get(id) !== entry) return null;
        entry.previewBlob = blob;
        entry.previewUrl = URL.createObjectURL(blob);
        return blob;
    }).catch(error => {
        console.warn("Image thumbnail creation failed", error);
        return null;
    });
    entry.cleanupTimer = setTimeout(() => releaseLocalMediaPreview(id), 15 * 60 * 1000);
    localMediaPreviewCache.set(id, entry);
    return entry;
}

export function releaseLocalMediaPreview(messageId, delay = 0) {
    const id = String(messageId || "");
    const entry = localMediaPreviewCache.get(id);
    if (!entry) return;
    if (delay > 0) {
        clearTimeout(entry.cleanupTimer);
        entry.cleanupTimer = setTimeout(() => releaseLocalMediaPreview(id), delay);
        return;
    }
    clearTimeout(entry.cleanupTimer);
    if (entry.originalUrl) URL.revokeObjectURL(entry.originalUrl);
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    localMediaPreviewCache.delete(id);
}

export function formatMediaSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function resolveMessageMediaUrl(orderId, messageId, variant = "original") {
    const normalizedVariant = variant === "preview" ? "preview" : "original";
    const key = `${orderId}:${messageId}:${normalizedVariant}`;
    const cached = mediaUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
    if (mediaUrlPending.has(key)) return mediaUrlPending.get(key);

    const request = (async () => {
        const response = await fetch("/api/chat-media-url", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ orderId, messageId, variant: normalizedVariant })
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

async function uploadToSignedTarget(target, data, fileName = "", timeoutMs = 0) {
    if (!target?.signedUrl || !data) return;
    const formData = new FormData();
    formData.append("cacheControl", "3600");
    if (fileName) formData.append("", data, fileName);
    else formData.append("", data);
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetch(target.signedUrl, {
            method: "PUT",
            headers: { "X-Upsert": "false" },
            body: formData,
            signal: controller?.signal
        });
        if (!response.ok) throw new Error("media-upload-failed");
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function uploadChatMedia({ orderId, senderId, messageId, file }) {
    const localPreview = localMediaPreviewCache.get(String(messageId));
    const generatedPreview = String(file?.type || "").startsWith("image/")
        ? await (localPreview?.ready || createImageThumbnail(file))
        : null;
    const previewBlob = generatedPreview?.size > 0 && generatedPreview.size <= 1024 * 1024
        ? generatedPreview
        : null;
    const preview = previewBlob ? {
        fileName: "thumbnail.webp",
        mimeType: previewBlob.type || "image/webp",
        fileSize: previewBlob.size
    } : null;

    const prepareResponse = await fetch("/api/prepare-chat-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            orderId,
            senderId,
            messageId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
            preview
        })
    });
    const prepared = await prepareResponse.json().catch(() => ({}));
    if (!prepareResponse.ok || !prepared.upload) {
        throw new Error(prepared.error || "media-prepare-failed");
    }

    const previewUpload = prepared.upload.preview && previewBlob
        ? uploadToSignedTarget(prepared.upload.preview, previewBlob, preview.fileName, 12_000)
            .then(() => true)
            .catch(error => {
                console.warn("Thumbnail upload failed; sending original image", error);
                return false;
            })
        : Promise.resolve(false);
    await uploadToSignedTarget(prepared.upload, file);
    const previewUploaded = await previewUpload;

    const finalizeResponse = await fetch("/api/finalize-chat-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId, senderId, messageId, previewUploaded })
    });
    const finalized = await finalizeResponse.json().catch(() => ({}));
    if (!finalizeResponse.ok) throw new Error(finalized.error || "media-finalize-failed");
    releaseLocalMediaPreview(messageId, 5 * 60 * 1000);
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
    const localPreview = message.messageType === "image"
        ? localMediaPreviewCache.get(String(message.id || ""))
        : null;
    const isReady = (message.uploadStatus === "ready" && Boolean(message.mediaPath)) || Boolean(legacyUrl || legacyPath);
    if (!isReady && !localPreview) return pendingView(message);

    const mediaUrl = () => legacyPath || message.mediaPath
        ? resolveMessageMediaUrl(orderId, message.id, "original")
        : Promise.resolve(legacyUrl);
    const previewMediaUrl = () => message.mediaPreviewPath
        ? resolveMessageMediaUrl(orderId, message.id, "preview")
        : mediaUrl();
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
        const image = document.createElement("img");
        image.alt = mediaName || "صورة مرفقة";
        image.loading = localPreview ? "eager" : "lazy";
        image.decoding = "async";
        const badge = document.createElement("span");
        badge.className = "media-open-badge";
        badge.textContent = message.uploadStatus === "pending" ? "جارٍ الإرسال..."
            : message.uploadStatus === "failed" ? "تعذر الإرسال"
                : "↗ عرض الأصل";
        if (message.uploadStatus === "pending") badge.classList.add("pending-badge");
        if (message.uploadStatus === "failed") badge.classList.add("failed-badge");
        originalLink.append(image, badge);
        originalLink.addEventListener("click", event => event.stopPropagation());

        if (localPreview) {
            originalLink.hidden = false;
            originalLink.href = localPreview.originalUrl;
            image.src = localPreview.previewUrl || localPreview.originalUrl;
            localPreview.ready.then(() => {
                if (localPreview.previewUrl && image.isConnected) image.src = localPreview.previewUrl;
            });
            if (isReady) {
                mediaUrl().then(url => {
                    originalLink.href = url;
                    badge.textContent = "↗ عرض الأصل";
                    badge.classList.remove("pending-badge", "failed-badge");
                }).catch(() => {});
            }
            wrapper.appendChild(originalLink);
            return wrapper;
        }

        originalLink.hidden = true;
        const loading = pendingView({ ...message, uploadStatus: "pending", messageType: "image" });
        wrapper.append(loading, originalLink);
        image.addEventListener("load", () => {
            originalLink.hidden = false;
            loading.remove();
        }, { once: true });

        mediaUrl().then(url => { originalLink.href = url; }).catch(() => {});
        previewMediaUrl().catch(() => mediaUrl()).then(url => {
            image.src = url;
        }).catch(() => {
            loading.classList.add("failed");
            loading.textContent = "تعذر تحميل الصورة";
        });
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
