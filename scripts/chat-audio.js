let activePlayback = null;

export function formatVoiceDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutesPart = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secondsPart = (seconds % 60).toString().padStart(2, "0");
    return `${minutesPart}:${secondsPart}`;
}

export async function uploadChatAudio({ orderId, senderId, messageId, blob, duration }) {
    const response = await fetch("/api/upload-chat-audio", {
        method: "POST",
        headers: {
            "Content-Type": blob.type || "audio/webm",
            "X-Chat-Order-Id": orderId,
            "X-Chat-Sender-Id": senderId,
            "X-Chat-Message-Id": messageId,
            "X-Chat-Audio-Duration": String(Math.max(1, Math.round(duration)))
        },
        body: blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "audio-upload-failed");
    return result;
}

function supportedRecordingType() {
    const options = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus"
    ];
    if (!("MediaRecorder" in window)) return "";
    return options.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

export function createVoiceRecorder({
    panel,
    composer,
    timer,
    pauseButton,
    cancelButton,
    sendButton,
    onSend,
    onNotify,
    maxSeconds = 180
}) {
    let stream = null;
    let recorder = null;
    let chunks = [];
    let timerId = null;
    let startedAt = 0;
    let pausedAt = 0;
    let totalPaused = 0;
    let sendWhenStopped = false;
    let busy = false;

    const elapsedMilliseconds = () => {
        if (!startedAt) return 0;
        const end = pausedAt || performance.now();
        return Math.max(0, end - startedAt - totalPaused);
    };

    const updateTimer = () => {
        const elapsed = elapsedMilliseconds();
        timer.textContent = formatVoiceDuration(elapsed / 1000);
        if (elapsed >= maxSeconds * 1000 && recorder && recorder.state !== "inactive") {
            onNotify(`الحد الأقصى للتسجيل ${Math.floor(maxSeconds / 60)} دقائق`);
            stopAndSend();
        }
    };

    const stopTracks = () => {
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
    };

    const reset = () => {
        clearInterval(timerId);
        timerId = null;
        stopTracks();
        recorder = null;
        chunks = [];
        startedAt = 0;
        pausedAt = 0;
        totalPaused = 0;
        sendWhenStopped = false;
        busy = false;
        timer.textContent = "00:00";
        pauseButton.textContent = "⏸";
        pauseButton.setAttribute("aria-label", "إيقاف التسجيل مؤقتًا");
        panel.classList.remove("is-paused", "is-uploading");
        panel.hidden = true;
        composer.hidden = false;
        cancelButton.disabled = false;
        pauseButton.disabled = false;
        sendButton.disabled = false;
    };

    const finish = async mimeType => {
        clearInterval(timerId);
        timerId = null;
        const duration = Math.max(1, Math.round(elapsedMilliseconds() / 1000));
        const shouldSend = sendWhenStopped;
        const audioChunks = chunks;
        stopTracks();

        if (!shouldSend || !audioChunks.length) {
            reset();
            return;
        }

        const blob = new Blob(audioChunks, { type: mimeType || audioChunks[0]?.type || "audio/webm" });
        panel.classList.add("is-uploading");
        timer.textContent = "جارٍ الإرسال...";
        cancelButton.disabled = true;
        pauseButton.disabled = true;
        sendButton.disabled = true;
        busy = true;
        try {
            await onSend(blob, { duration, mimeType: blob.type });
        } catch (error) {
            console.error("Voice message send failed", error);
            onNotify(error?.message === "audio-storage-not-configured"
                ? "يجب تفعيل Vercel Blob أولاً"
                : "تعذر إرسال الرسالة الصوتية");
        } finally {
            reset();
        }
    };

    async function start() {
        if (recorder || busy) return false;
        if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
            onNotify("التسجيل الصوتي غير مدعوم في هذا المتصفح");
            return false;
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            const mimeType = supportedRecordingType();
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            chunks = [];
            sendWhenStopped = false;
            recorder.addEventListener("dataavailable", event => {
                if (event.data?.size) chunks.push(event.data);
            });
            recorder.addEventListener("stop", () => finish(recorder?.mimeType || mimeType), { once: true });
            recorder.addEventListener("error", () => {
                onNotify("حدث خطأ أثناء التسجيل");
                sendWhenStopped = false;
            });
            recorder.start(250);
            startedAt = performance.now();
            pausedAt = 0;
            totalPaused = 0;
            composer.hidden = true;
            panel.hidden = false;
            timer.textContent = "00:00";
            timerId = setInterval(updateTimer, 200);
            updateTimer();
            return true;
        } catch (error) {
            console.error("Microphone permission failed", error);
            stopTracks();
            recorder = null;
            onNotify(error?.name === "NotAllowedError"
                ? "اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح"
                : "تعذر تشغيل الميكروفون");
            return false;
        }
    }

    function cancel() {
        if (!recorder || busy) return;
        sendWhenStopped = false;
        if (recorder.state !== "inactive") recorder.stop();
        else reset();
    }

    function stopAndSend() {
        if (!recorder || busy) return;
        sendWhenStopped = true;
        if (recorder.state === "paused") recorder.resume();
        if (recorder.state !== "inactive") recorder.stop();
    }

    function togglePause() {
        if (!recorder || busy) return;
        if (recorder.state === "recording") {
            recorder.pause();
            pausedAt = performance.now();
            panel.classList.add("is-paused");
            pauseButton.textContent = "▶";
            pauseButton.setAttribute("aria-label", "متابعة التسجيل");
        } else if (recorder.state === "paused") {
            totalPaused += performance.now() - pausedAt;
            pausedAt = 0;
            recorder.resume();
            panel.classList.remove("is-paused");
            pauseButton.textContent = "⏸";
            pauseButton.setAttribute("aria-label", "إيقاف التسجيل مؤقتًا");
        }
        updateTimer();
    }

    cancelButton.addEventListener("click", cancel);
    sendButton.addEventListener("click", stopAndSend);
    pauseButton.addEventListener("click", togglePause);
    window.addEventListener("pagehide", cancel);

    return {
        start,
        cancel,
        stopAndSend,
        get active() { return Boolean(recorder) || busy; }
    };
}

function createWaveform() {
    const wave = document.createElement("span");
    wave.className = "voice-playback-wave";
    [8, 15, 11, 19, 13, 22, 16, 10, 20, 14, 18, 9, 16, 21, 12, 17].forEach(height => {
        const bar = document.createElement("i");
        bar.style.height = `${height}px`;
        wave.appendChild(bar);
    });
    return wave;
}

export function createAudioMessagePlayer(message, orderId) {
    const wrapper = document.createElement("div");
    wrapper.className = `voice-message-player ${message.uploadStatus || "ready"}`;

    if (message.uploadStatus === "pending") {
        const spinner = document.createElement("span");
        spinner.className = "voice-upload-spinner";
        const label = document.createElement("span");
        label.textContent = "جارٍ إرسال الصوت...";
        wrapper.append(spinner, label);
        return wrapper;
    }

    if (message.uploadStatus === "failed" || (!message.audioUrl && !message.mediaPath)) {
        wrapper.classList.add("failed");
        wrapper.textContent = "⚠ تعذر إرسال الرسالة الصوتية";
        return wrapper;
    }

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    if (message.mediaProvider !== "supabase" && message.audioUrl) audio.src = message.audioUrl;

    const resolveAudioUrl = async () => {
        if (audio.src) return audio.src;
        const response = await fetch("/api/chat-media-url", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ orderId, messageId: message.id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) throw new Error(result.error || "media-url-failed");
        audio.src = result.url;
        return result.url;
    };

    const play = document.createElement("button");
    play.type = "button";
    play.className = "voice-play-button";
    play.setAttribute("aria-label", "تشغيل الرسالة الصوتية");
    play.textContent = "▶";

    const track = document.createElement("div");
    track.className = "voice-track";
    const waveform = createWaveform();
    const range = document.createElement("input");
    range.type = "range";
    range.className = "voice-progress";
    range.min = "0";
    range.max = String(Math.max(1, Number(message.audioDuration) || 1));
    range.step = "0.1";
    range.value = "0";
    range.setAttribute("aria-label", "موضع تشغيل الرسالة الصوتية");
    const duration = document.createElement("span");
    duration.className = "voice-duration";
    duration.textContent = formatVoiceDuration(message.audioDuration);
    track.append(waveform, range, duration);
    wrapper.append(play, track, audio);

    const setPlaying = playing => {
        wrapper.classList.toggle("is-playing", playing);
        play.textContent = playing ? "❚❚" : "▶";
        play.setAttribute("aria-label", playing ? "إيقاف الرسالة الصوتية" : "تشغيل الرسالة الصوتية");
    };

    play.addEventListener("click", async event => {
        event.stopPropagation();
        if (audio.paused) {
            if (activePlayback && activePlayback !== audio) activePlayback.pause();
            activePlayback = audio;
            try {
                await resolveAudioUrl();
                await audio.play();
            } catch (error) {
                console.error("Audio playback failed", error);
                play.textContent = "!";
                play.setAttribute("aria-label", "تعذر تشغيل الرسالة الصوتية");
            }
        } else {
            audio.pause();
        }
    });
    range.addEventListener("pointerdown", event => event.stopPropagation());
    range.addEventListener("input", event => {
        event.stopPropagation();
        audio.currentTime = Number(range.value) || 0;
    });
    audio.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(audio.duration)) {
            range.max = String(audio.duration);
            duration.textContent = formatVoiceDuration(audio.duration);
        }
    });
    audio.addEventListener("timeupdate", () => {
        range.value = String(audio.currentTime || 0);
        duration.textContent = `${formatVoiceDuration(audio.currentTime)} / ${formatVoiceDuration(audio.duration || message.audioDuration)}`;
    });
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => {
        setPlaying(false);
        range.value = "0";
        duration.textContent = formatVoiceDuration(audio.duration || message.audioDuration);
    });

    return wrapper;
}
