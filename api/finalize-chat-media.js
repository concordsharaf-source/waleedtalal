'use strict';

const path = require('path');
const { resolveSupabaseStorage } = require('../server/media-storage');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

function messageLabel(message) {
    if (message.deletedForAll) return 'تم حذف هذه الرسالة';
    if (message.messageType === 'image') return '📷 صورة';
    if (message.messageType === 'video') return '🎬 فيديو';
    return `📎 ${String(message.mediaName || 'ملف').slice(0, 120)}`;
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
    if (
        !/^[A-Za-z0-9_-]{1,1500}$/.test(orderId) ||
        !['admin', 'client'].includes(senderId) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(messageId)
    ) return response.status(400).json({ error: 'invalid-request' });

    try {
        initializeAdmin();
        const database = getFirestore();
        const orderRef = database.collection('orders').doc(orderId);
        const snapshot = await orderRef.get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });
        const pending = (Array.isArray(snapshot.data()?.chatMessages) ? snapshot.data().chatMessages : [])
            .find(item => item?.id === messageId && item.senderId === senderId);
        if (!pending || pending.uploadStatus !== 'pending' || !pending.mediaPath) {
            return response.status(409).json({ error: 'media-message-not-pending' });
        }

        const folder = path.posix.dirname(pending.mediaPath);
        const fileName = path.posix.basename(pending.mediaPath);
        const storage = await resolveSupabaseStorage();
        const { data: files, error: listError } = await storage.client.storage.from(storage.bucket).list(folder, {
            limit: 10,
            search: fileName
        });
        if (listError || !files?.some(file => file.name === fileName)) {
            return response.status(409).json({ error: 'uploaded-media-not-found' });
        }
        let previewAvailable = false;
        if (pending.mediaPreviewPath) {
            const previewFolder = path.posix.dirname(pending.mediaPreviewPath);
            const previewName = path.posix.basename(pending.mediaPreviewPath);
            const { data: previews, error: previewError } = await storage.client.storage.from(storage.bucket).list(previewFolder, {
                limit: 10,
                search: previewName
            });
            previewAvailable = !previewError && previews?.some(file => file.name === previewName) === true;
        }

        let finalLabel = '📎 ملف';
        await database.runTransaction(async transaction => {
            const latestSnapshot = await transaction.get(orderRef);
            if (!latestSnapshot.exists) throw new Error('order-not-found');
            let changed = false;
            const messages = (Array.isArray(latestSnapshot.data()?.chatMessages) ? latestSnapshot.data().chatMessages : [])
                .map(message => {
                    if (message?.id !== messageId || message.senderId !== senderId || message.uploadStatus !== 'pending') return message;
                    changed = true;
                    finalLabel = messageLabel(message);
                    const finalized = { ...message, text: finalLabel, uploadStatus: 'ready' };
                    if (!previewAvailable) {
                        delete finalized.mediaPreviewPath;
                        delete finalized.mediaPreviewMime;
                        delete finalized.mediaPreviewBytes;
                    }
                    return finalized;
                });
            if (!changed) throw new Error('media-message-not-pending');
            transaction.update(orderRef, {
                chatMessages: messages,
                chatLastMessage: finalLabel,
                chatLastSender: senderId,
                chatUpdatedAt: FieldValue.serverTimestamp()
            });
        });

        return response.status(200).json({ uploaded: true, messageId, previewAvailable });
    } catch (error) {
        console.error('Finalize chat media error', error?.message || error);
        return response.status(500).json({ error: 'media-finalize-failed' });
    }
};
