export async function uploadChatMedia(file, orderId, actor) {
    if (!file || !orderId || !actor) throw new Error("invalid-media");
    const body = new FormData();
    body.append("file", file);
    body.append("orderId", orderId);
    body.append("actor", actor);
    const response = await fetch("/api/upload-chat-media", { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) throw new Error(result.error || "media-upload-failed");
    return result;
}

export function mediaTypeFor(file) {
    if (file.type.startsWith("audio/")) return "voice";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    return "file";
}

export function appendMessageMedia(container, message) {
    const media = message.media;
    if (!media?.url) return;
    const type = message.messageType || media.mimeType || "file";
    if (type === "image" || String(media.mimeType).startsWith("image/")) {
        const image = document.createElement("img");
        image.src = media.url;
        image.alt = media.name || "صورة مرفقة";
        image.loading = "lazy";
        image.className = "chat-media-image";
        container.appendChild(image);
    } else if (type === "voice" || String(media.mimeType).startsWith("audio/")) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = media.url;
        audio.className = "chat-media-audio";
        container.appendChild(audio);
    } else if (type === "video" || String(media.mimeType).startsWith("video/")) {
        const video = document.createElement("video");
        video.controls = true;
        video.preload = "metadata";
        video.src = media.url;
        video.className = "chat-media-video";
        container.appendChild(video);
    } else {
        const link = document.createElement("a");
        link.href = media.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "chat-media-file";
        link.textContent = `📎 ${media.name || "فتح الملف"}`;
        container.appendChild(link);
    }
}
