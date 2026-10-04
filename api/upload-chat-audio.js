'use strict';

const crypto = require('crypto');
const { put, del } = require('@vercel/blob');
const { hasSupabaseCredentials, resolveSupabaseStorage } = require('../server/media-storage');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 180;
const ALLOWED_AUDIO_TYPES = new Map([
    ['audio/webm', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav']
]);

function parseServiceAccount() {
    const rawValue = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!rawValue) throw new Error('service-account-not-configured');

    let raw = rawValue;
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    let account = JSON.parse(raw);
    if (typeof account === 'string') account = JSON.parse(account);
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
    if (!account.project_id || !account.client_email || !account.private_key) {
        throw new Error('invalid-service-account');
    }
    return account;
}

function initializeAdmin() {
    if (!getApps().length) initializeApp({ credential: cert(parseServiceAccount()) });
}

async function readRequestBuffer(request) {
    if (Buffer.isBuffer(request.body)) return request.body;
    if (typeof request.body === 'string') return Buffer.from(request.body);

    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_AUDIO_BYTES) throw new Error('audio-too-large');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function plainHeader(request, name) {
    const value = request.headers?.[name];
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

async function uploadAudioObject(pathname, buffer, contentType) {
    let supabase = null;
    if (hasSupabaseCredentials()) {
        try { supabase = await resolveSupabaseStorage(); } catch (error) {
            if (!String(process.env.BLOB_READ_WRITE_TOKEN || '').trim()) throw error;
        }
    }
    if (supabase) {
        const { error } = await supabase.client.storage.from(supabase.bucket).upload(pathname, buffer, {
            contentType,
            cacheControl: '3600',
            upsert: false
        });
        if (!error) return { provider: 'supabase', pathname, url: '', supabase };
        // إذا كان إعداد Supabase حديثاً أو الـBucket غير جاهز، نبقي الصوت عاملاً عبر Blob المتصل.
        if (!String(process.env.BLOB_READ_WRITE_TOKEN || '').trim()) {
            throw new Error(`supabase-upload:${error.message}`);
        }
    }

    const token = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
    if (!token) throw new Error('audio-storage-not-configured');
    const blob = await put(pathname, buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType,
        token
    });
    return { provider: 'vercel-blob', pathname: blob.pathname, url: blob.url };
}

async function removeAudioObject(uploaded) {
    if (!uploaded) return;
    if (uploaded.provider === 'supabase') {
        await uploaded.supabase.client.storage.from(uploaded.supabase.bucket).remove([uploaded.pathname]);
        return;
    }
    if (uploaded.url) {
        await del(uploaded.url, { token: String(process.env.BLOB_READ_WRITE_TOKEN || '') });
    }
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const orderId = plainHeader(request, 'x-chat-order-id').trim();
    const senderId = plainHeader(request, 'x-chat-sender-id').trim();
    const messageId = plainHeader(request, 'x-chat-message-id').trim();
    const contentType = plainHeader(request, 'content-type').split(';')[0].trim().toLowerCase();
    const duration = Math.round(Number(plainHeader(request, 'x-chat-audio-duration')) || 0);
    const extension = ALLOWED_AUDIO_TYPES.get(contentType);

    if (
        !/^[A-Za-z0-9_-]{1,1500}$/.test(orderId) ||
        !['admin', 'client'].includes(senderId) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(messageId) ||
        !extension ||
        duration < 1 ||
        duration > MAX_AUDIO_SECONDS
    ) {
        return response.status(400).json({ error: 'invalid-audio-request' });
    }

    const hasSupabase = hasSupabaseCredentials();
    const hasBlob = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim());
    if (!hasSupabase && !hasBlob) {
        return response.status(503).json({ error: 'audio-storage-not-configured' });
    }

    let uploaded = null;
    try {
        initializeAdmin();
        const database = getFirestore();
        const orderRef = database.collection('orders').doc(orderId);
        const snapshot = await orderRef.get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });

        const order = snapshot.data() || {};
        const pendingMessage = (Array.isArray(order.chatMessages) ? order.chatMessages : [])
            .find(item => item && item.id === messageId && item.senderId === senderId);
        if (!pendingMessage || pendingMessage.messageType !== 'audio' || pendingMessage.uploadStatus !== 'pending') {
            return response.status(409).json({ error: 'audio-message-not-pending' });
        }

        const serverUpdateTime = typeof order.chatUpdatedAt?.toMillis === 'function'
            ? order.chatUpdatedAt.toMillis()
            : 0;
        if (!serverUpdateTime || Math.abs(Date.now() - serverUpdateTime) > 10 * 60 * 1000) {
            return response.status(409).json({ error: 'audio-message-expired' });
        }

        const audioBuffer = await readRequestBuffer(request);
        if (!audioBuffer.length) return response.status(400).json({ error: 'empty-audio' });
        if (audioBuffer.length > MAX_AUDIO_BYTES) return response.status(413).json({ error: 'audio-too-large' });

        const orderHash = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 24);
        const pathname = `chat-audio/${orderHash}/${messageId}.${extension}`;
        uploaded = await uploadAudioObject(pathname, audioBuffer, contentType);

        await database.runTransaction(async transaction => {
            let messageUpdated = false;
            const latestSnapshot = await transaction.get(orderRef);
            if (!latestSnapshot.exists) throw new Error('order-not-found');
            const latest = latestSnapshot.data() || {};
            const messages = Array.isArray(latest.chatMessages) ? latest.chatMessages : [];
            const next = messages.map(message => {
                if (
                    message?.id !== messageId ||
                    message.senderId !== senderId ||
                    message.messageType !== 'audio' ||
                    message.uploadStatus !== 'pending'
                ) return message;
                messageUpdated = true;
                return {
                    ...message,
                    text: '🎤 رسالة صوتية',
                    audioUrl: uploaded.url || '',
                    audioPathname: uploaded.pathname,
                    mediaProvider: uploaded.provider,
                    mediaPath: uploaded.pathname,
                    audioDuration: duration,
                    audioMime: contentType,
                    audioBytes: audioBuffer.length,
                    uploadStatus: 'ready'
                };
            });
            if (!messageUpdated) throw new Error('audio-message-not-pending');
            transaction.update(orderRef, {
                chatMessages: next,
                chatLastMessage: '🎤 رسالة صوتية',
                chatUpdatedAt: FieldValue.serverTimestamp()
            });
        });

        return response.status(200).json({
            uploaded: true,
            messageId,
            duration,
            bytes: audioBuffer.length
        });
    } catch (error) {
        try { await removeAudioObject(uploaded); } catch { /* تنظيف اختياري */ }
        console.error('Chat audio upload error', error?.message || error);
        const status = error?.message === 'audio-too-large' ? 413
            : error?.message === 'audio-message-not-pending' ? 409
                : ['service-account-not-configured', 'invalid-service-account'].includes(error?.message) ? 503
                    : 500;
        return response.status(status).json({
            error: status === 413 ? 'audio-too-large'
                : status === 409 ? 'audio-message-not-pending'
                    : status === 503 ? 'audio-server-not-configured'
                        : 'audio-upload-failed'
        });
    }
};

module.exports.config = {
    api: {
        bodyParser: false
    }
};
