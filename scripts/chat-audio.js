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
    triggerButton = null,
    isVoiceMode = () => true,
    onStart = () => {},
    onSend,
    onNotify,
    maxSeconds = 180
}) {
    const LOCK_DISTANCE = 72;
    const CANCEL_DISTANCE = 110;
    const waveElement = panel.querySelector(".voice-live-wave");
    const waveBars = [];
    let stream = null;
    let recorder = null;
    let chunks = [];
    let timerId = null;
    let startedAt = 0;
    let pausedAt = 0;
    let totalPaused = 0;
    let sendWhenStopped = false;
    let busy = false;
    let startingPromise = null;
    let startSequence = 0;
    let audioContext = null;
    let audioSource = null;
    let analyser = null;
    let analyserData = null;
    let waveformFrame = 0;
    let gesture = null;
    let suppressClickUntil = 0;

    const ensureWaveform = () => {
        if (!waveElement || waveBars.length) return;
        waveElement.textContent = "";
        for (let index = 0; index < 18; index += 1) {
            const bar = document.createElement("i");
            const restingHeight = 5 + ((index * 7) % 8);
            bar.style.height = `${restingHeight}px`;
            bar.dataset.height = String(restingHeight);
            waveElement.appendChild(bar);
            waveBars.push(bar);
        }
    };

    const resetWaveform = () => {
        waveBars.forEach((bar, index) => {
            const height = 5 + ((index * 7) % 8);
            bar.style.height = `${height}px`;
            bar.dataset.height = String(height);
        });
    };

    const stopVisualizer = () => {
        cancelAnimationFrame(waveformFrame);
        waveformFrame = 0;
        try { audioSource?.disconnect(); } catch { /* انتهى المصدر */ }
        audioSource = null;
        analyser = null;
        analyserData = null;
        if (audioContext) audioContext.close().catch(() => {});
        audioContext = null;
    };

    const drawWaveform = () => {
        if (!analyser || !analyserData) return;
        if (recorder?.state === "recording") {
            analyser.getByteTimeDomainData(analyserData);
            const segmentSize = Math.max(1, Math.floor(analyserData.length / waveBars.length));
            waveBars.forEach((bar, index) => {
                const segmentStart = index * segmentSize;
                const segmentEnd = Math.min(analyserData.length, segmentStart + segmentSize);
                let peak = 0;
                for (let sample = segmentStart; sample < segmentEnd; sample += 1) {
                    peak = Math.max(peak, Math.abs(analyserData[sample] - 128) / 128);
                }
                const target = 5 + Math.min(1, peak * 5.5) * 25;
                const previous = Number(bar.dataset.height) || 5;
                const height = previous * .52 + target * .48;
                bar.dataset.height = height.toFixed(2);
                bar.style.height = `${height.toFixed(1)}px`;
            });
        }
        waveformFrame = requestAnimationFrame(drawWaveform);
    };

    const startVisualizer = mediaStream => {
        ensureWaveform();
        stopVisualizer();
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            audioContext = new AudioContextClass();
            if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
            audioSource = audioContext.createMediaStreamSource(mediaStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = .72;
            analyserData = new Uint8Array(analyser.fftSize);
            audioSource.connect(analyser);
            drawWaveform();
        } catch (error) {
            console.warn("Live voice waveform unavailable", error);
            stopVisualizer();
        }
    };

    const elapsedMilliseconds = () => {
        if (!startedAt) return 0;
        const end = pausedAt || performance.now();
        return Math.max(0, end - startedAt - totalPaused);
    };

    const updateTimer = () => {
        const elapsed = elapsedMilliseconds();
        timer.textContent = formatVoiceDuration(elapsed / 1000);
        timer.dateTime = `PT${Math.max(0, Math.floor(elapsed / 1000))}S`;
        if (elapsed >= maxSeconds * 1000 && recorder && recorder.state !== "inactive") {
            onNotify(`الحد الأقصى للتسجيل ${Math.floor(maxSeconds / 60)} دقائق`);
            stopAndSend();
        }
    };

    const stopTracks = () => {
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
    };

    const setRecordingMode = locked => {
        panel.classList.toggle("is-locked", locked);
        panel.classList.toggle("is-holding", !locked);
        panel.classList.remove("is-lock-ready");
        panel.style.removeProperty("--voice-lock-shift");
    };

    const clearGesture = () => {
        triggerButton?.classList.remove("is-recording-press");
        panel.classList.remove("is-lock-ready");
        panel.style.removeProperty("--voice-lock-shift");
        gesture = null;
    };

    const reset = () => {
        startSequence += 1;
        clearInterval(timerId);
        timerId = null;
        stopVisualizer();
        stopTracks();
        recorder = null;
        chunks = [];
        startedAt = 0;
        pausedAt = 0;
        totalPaused = 0;
        sendWhenStopped = false;
        busy = false;
        timer.textContent = "00:00";
        timer.dateTime = "PT0S";
        pauseButton.textContent = "⏸";
        pauseButton.setAttribute("aria-label", "إيقاف التسجيل مؤقتًا");
        panel.classList.remove("is-paused", "is-uploading", "is-holding", "is-locked", "is-lock-ready");
        panel.style.removeProperty("--voice-lock-shift");
        panel.hidden = true;
        composer.hidden = false;
        cancelButton.disabled = false;
        pauseButton.disabled = false;
        sendButton.disabled = false;
        clearGesture();
        resetWaveform();
    };

    const finish = async mimeType => {
        clearInterval(timerId);
        timerId = null;
        stopVisualizer();
        const duration = Math.max(1, Math.round(elapsedMilliseconds() / 1000));
        const shouldSend = sendWhenStopped;
        const audioChunks = chunks;
        stopTracks();

        if (!shouldSend || !audioChunks.length) {
            reset();
            return;
        }

        const blob = new Blob(audioChunks, { type: mimeType || audioChunks[0]?.type || "audio/webm" });
        panel.classList.remove("is-holding");
        panel.classList.add("is-locked", "is-uploading");
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
                ? "يجب تفعيل تخزين الصوت أولاً"
                : "تعذر إرسال الرسالة الصوتية");
        } finally {
            reset();
        }
    };

    async function start({ locked = true } = {}) {
        if (recorder || busy || startingPromise) return false;
        if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
            onNotify("التسجيل الصوتي غير مدعوم في هذا المتصفح");
            return false;
        }

        const sequence = ++startSequence;
        const task = (async () => {
            try {
                const acquiredStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                if (sequence !== startSequence) {
                    acquiredStream.getTracks().forEach(track => track.stop());
                    return false;
                }

                stream = acquiredStream;
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
                    if (recorder?.state !== "inactive") recorder.stop();
                    else reset();
                }, { once: true });
                recorder.start(200);
                startedAt = performance.now();
                pausedAt = 0;
                totalPaused = 0;
                onStart();
                composer.hidden = true;
                panel.hidden = false;
                setRecordingMode(locked);
                timer.textContent = "00:00";
                timer.dateTime = "PT0S";
                startVisualizer(stream);
                timerId = setInterval(updateTimer, 160);
                updateTimer();
                return true;
            } catch (error) {
                console.error("Microphone permission failed", error);
                stopVisualizer();
                stopTracks();
                recorder = null;
                if (sequence === startSequence) {
                    onNotify(error?.name === "NotAllowedError"
                        ? "اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح"
                        : "تعذر تشغيل الميكروفون");
                }
                return false;
            }
        })();

        startingPromise = task;
        try {
            return await task;
        } finally {
            if (startingPromise === task) startingPromise = null;
        }
    }

    function cancel() {
        if (busy) return;
        if (!recorder) {
            if (startingPromise) {
                startSequence += 1;
                clearGesture();
                composer.hidden = false;
                panel.hidden = true;
            }
            return;
        }
        sendWhenStopped = false;
        if (recorder.state !== "inactive") recorder.stop();
        else reset();
    }

    function stopAndSend() {
        if (!recorder || busy) return;
        sendWhenStopped = true;
        clearGesture();
        panel.classList.remove("is-holding");
        panel.classList.add("is-locked");
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

    const lockGesture = currentGesture => {
        if (!currentGesture || currentGesture.locked) return;
        currentGesture.locked = true;
        setRecordingMode(true);
        if (navigator.vibrate) navigator.vibrate(35);
    };

    const handleGestureMove = event => {
        const currentGesture = gesture;
        if (!currentGesture || event.pointerId !== currentGesture.pointerId || currentGesture.released) return;
        if (event.cancelable) event.preventDefault();
        const upwardDistance = Math.max(0, currentGesture.startY - event.clientY);
        const inwardDistance = Math.max(0, event.clientX - currentGesture.startX);
        const lockProgress = Math.min(1, upwardDistance / LOCK_DISTANCE);
        panel.style.setProperty("--voice-lock-shift", `${Math.round(-lockProgress * 15)}px`);
        panel.classList.toggle("is-lock-ready", lockProgress >= .72);

        if (upwardDistance >= LOCK_DISTANCE) {
            lockGesture(currentGesture);
            return;
        }
        if (inwardDistance >= CANCEL_DISTANCE) {
            currentGesture.cancelled = true;
            suppressClickUntil = performance.now() + 500;
            cancel();
            clearGesture();
            onNotify("تم إلغاء التسجيل");
        }
    };

    const handleGestureEnd = event => {
        const currentGesture = gesture;
        if (!currentGesture || event.pointerId !== currentGesture.pointerId) return;
        if (event.cancelable) event.preventDefault();
        suppressClickUntil = performance.now() + 500;
        currentGesture.released = true;
        if (currentGesture.locked) {
            clearGesture();
            return;
        }
        if (!currentGesture.started) {
            currentGesture.cancelled = true;
            return;
        }
        stopAndSend();
    };

    const handleGestureCancel = event => {
        const currentGesture = gesture;
        if (!currentGesture || event.pointerId !== currentGesture.pointerId) return;
        currentGesture.cancelled = true;
        suppressClickUntil = performance.now() + 500;
        cancel();
        clearGesture();
    };

    const beginGesture = async event => {
        if (!triggerButton || !isVoiceMode() || Number(event.button || 0) > 0 || event.isPrimary === false) return;
        if (gesture || recorder || startingPromise || busy) return;
        event.preventDefault();
        suppressClickUntil = performance.now() + 500;
        const currentGesture = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            started: false,
            released: false,
            cancelled: false,
            locked: false
        };
        gesture = currentGesture;
        triggerButton.classList.add("is-recording-press");
        const started = await start({ locked: false });
        if (gesture !== currentGesture) {
            if (started && currentGesture.locked) setRecordingMode(true);
            else if (started) cancel();
            return;
        }
        currentGesture.started = started;
        if (!started) {
            clearGesture();
            return;
        }
        if (currentGesture.locked) setRecordingMode(true);
        if (currentGesture.cancelled) {
            cancel();
            clearGesture();
        } else if (currentGesture.released && !currentGesture.locked) {
            cancel();
            clearGesture();
        }
    };

    const touchAsPointer = (event, touch) => ({
        pointerId: gesture?.pointerId ?? `touch-${touch.identifier}`,
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        isPrimary: true,
        cancelable: event.cancelable,
        preventDefault: () => {
            if (event.cancelable) event.preventDefault();
        }
    });

    const primaryChangedTouch = event => event.changedTouches?.[0] || event.touches?.[0] || null;

    ensureWaveform();
    cancelButton.addEventListener("click", cancel);
    sendButton.addEventListener("click", stopAndSend);
    pauseButton.addEventListener("click", togglePause);

    if (triggerButton) {
        triggerButton.style.touchAction = "none";
        triggerButton.addEventListener("pointerdown", beginGesture);
        window.addEventListener("pointermove", handleGestureMove, { passive: false });
        window.addEventListener("pointerup", handleGestureEnd, { passive: false });
        window.addEventListener("pointercancel", handleGestureCancel);

        // دعم مباشر للمس في Samsung Internet وWebView عند عدم اكتمال أحداث Pointer.
        triggerButton.addEventListener("touchstart", event => {
            const touch = primaryChangedTouch(event);
            if (touch) beginGesture(touchAsPointer(event, touch));
        }, { passive: false });
        window.addEventListener("touchmove", event => {
            const touch = primaryChangedTouch(event);
            if (touch) handleGestureMove(touchAsPointer(event, touch));
        }, { passive: false });
        window.addEventListener("touchend", event => {
            const touch = primaryChangedTouch(event);
            if (touch) handleGestureEnd(touchAsPointer(event, touch));
        }, { passive: false });
        window.addEventListener("touchcancel", event => {
            const touch = primaryChangedTouch(event);
            if (touch) handleGestureCancel(touchAsPointer(event, touch));
        }, { passive: false });

        triggerButton.addEventListener("click", event => {
            if (!isVoiceMode()) return;
            event.preventDefault();
            if (performance.now() <= suppressClickUntil) return;
            start({ locked: true });
        });
        triggerButton.addEventListener("contextmenu", event => {
            if (isVoiceMode()) event.preventDefault();
        });
    }

    window.addEventListener("pagehide", cancel);

    return {
        start,
        cancel,
        stopAndSend,
        get active() { return Boolean(recorder) || Boolean(startingPromise) || busy; }
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
