'use strict';

const crypto = require('crypto');
const path = require('path');
const { mediaStorageCredentials, resolveSupabaseStorage } = require('../server/media-storage');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const ALLOWED_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_DOCUMENT_TYPES = new Set([
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function parseServiceAccount() {
    const rawValue = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!rawValue) throw new Error('service-account-not-configured');
    let raw = rawValue;
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    let account = JSON.parse(raw);
    if (typeof account === 'string') account = JSON.parse(account);
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
    if (!account.project_id || !account.client_email || !account.private_key) throw new Error('invalid-service-account');
    return account;
}

function initializeAdmin() {
    if (!getApps().length) initializeApp({ credential: cert(parseServiceAccount()) });
}

function parseBody(request) {
    if (request.body && typeof request.body === 'object') return request.body;
    try { return JSON.parse(String(request.body || '{}')); } catch { return {}; }
}

function safeFileName(name, mimeType) {
    const original = String(name || 'file').normalize('NFKC').slice(0, 120);
    const extension = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const base = path.basename(original, path.extname(original))
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'file';
    const fallback = mimeType.startsWith('image/') ? '.jpg'
        : mimeType.startsWith('video/') ? '.mp4'
            : mimeType.startsWith('audio/') ? '.m4a'
                : '';
    return `${base}${extension || fallback}`;
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const body = parseBody(request);
    const orderId = String(body.orderId || '').trim();
    const senderId = String(body.senderId || '').trim();
    const messageId = String(body.messageId || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0].toLowerCase();
    const fileSize = Math.round(Number(body.fileSize) || 0);
    const allowedType = ALLOWED_PREFIXES.some(prefix => mimeType.startsWith(prefix)) || ALLOWED_DOCUMENT_TYPES.has(mimeType);
    const previewRequest = body.preview && typeof body.preview === 'object' ? body.preview : null;
    const previewMime = String(previewRequest?.mimeType || '').split(';')[0].toLowerCase();
    const previewSize = Math.round(Number(previewRequest?.fileSize) || 0);
    const validPreview = !previewRequest || (
        ['image/webp', 'image/jpeg'].includes(previewMime) &&
        previewSize > 0 &&
        previewSize <= MAX_PREVIEW_BYTES
    );

    if (
        !/^[A-Za-z0-9_-]{1,1500}$/.test(orderId) ||
        !['admin', 'client'].includes(senderId) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(messageId) ||
        !fileName || !allowedType || !validPreview || fileSize < 1 || fileSize > MAX_MEDIA_BYTES
    ) {
        return response.status(fileSize > MAX_MEDIA_BYTES ? 413 : 400).json({
            error: fileSize > MAX_MEDIA_BYTES ? 'media-too-large' : 'invalid-media-request'
        });
    }

    const credentials = mediaStorageCredentials();
    if (!credentials.url || !credentials.serviceKey) {
        return response.status(503).json({ error: 'supabase-media-not-configured' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const orderRef = database.collection('orders').doc(orderId);
        const snapshot = await orderRef.get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });
        const pending = (Array.isArray(snapshot.data()?.chatMessages) ? snapshot.data().chatMessages : [])
            .find(item => item?.id === messageId && item.senderId === senderId);
        if (!pending || !['image', 'video', 'file'].includes(pending.messageType) || pending.uploadStatus !== 'pending') {
            return response.status(409).json({ error: 'media-message-not-pending' });
        }
        if (previewRequest && pending.messageType !== 'image') {
            return response.status(400).json({ error: 'invalid-media-preview' });
        }

        const orderHash = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 24);
        const objectPath = `chat-media/${orderHash}/${messageId}/${safeFileName(fileName, mimeType)}`;
        const previewPath = previewRequest
            ? `chat-media/${orderHash}/${messageId}/_preview/thumbnail.${previewMime === 'image/jpeg' ? 'jpg' : 'webp'}`
            : '';
        const storage = await resolveSupabaseStorage();
        const { data: originalUpload, error: originalError } = await storage.client.storage
            .from(storage.bucket)
            .createSignedUploadUrl(objectPath, { upsert: false });
        if (originalError || !originalUpload?.token) {
            throw new Error(originalError?.message || 'signed-upload-failed');
        }
        let previewUpload = null;
        if (previewPath) {
            const { data, error } = await storage.client.storage
                .from(storage.bucket)
                .createSignedUploadUrl(previewPath, { upsert: false });
            if (error || !data?.token) throw new Error(error?.message || 'preview-signed-upload-failed');
            previewUpload = data;
        }

        await database.runTransaction(async transaction => {
            const latestSnapshot = await transaction.get(orderRef);
            if (!latestSnapshot.exists) throw new Error('order-not-found');
            let changed = false;
            const messages = (Array.isArray(latestSnapshot.data()?.chatMessages) ? latestSnapshot.data().chatMessages : [])
                .map(message => {
                    if (message?.id !== messageId || message.senderId !== senderId || message.uploadStatus !== 'pending') return message;
                    changed = true;
                    return {
                        ...message,
                        mediaProvider: 'supabase',
                        mediaPath: objectPath,
                        mediaName: fileName.slice(0, 180),
                        mediaMime: mimeType,
                        mediaBytes: fileSize,
                        ...(previewPath ? {
                            mediaPreviewPath: previewPath,
                            mediaPreviewMime: previewMime,
                            mediaPreviewBytes: previewSize
                        } : {})
                    };
                });
            if (!changed) throw new Error('media-message-not-pending');
            transaction.update(orderRef, { chatMessages: messages, chatUpdatedAt: FieldValue.serverTimestamp() });
        });

        return response.status(200).json({
            upload: {
                signedUrl: originalUpload.signedUrl,
                bucket: storage.bucket,
                path: objectPath,
                token: originalUpload.token,
                preview: previewUpload ? {
                    signedUrl: previewUpload.signedUrl,
                    path: previewPath,
                    token: previewUpload.token
                } : null
            }
        });
    } catch (error) {
        console.error('Prepare chat media error', error?.message || error);
        return response.status(500).json({ error: 'media-prepare-failed' });
    }
};
