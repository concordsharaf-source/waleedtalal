'use strict';

const { resolveSupabaseStorage } = require('../server/media-storage');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const body = parseBody(request);
    const orderId = String(body.orderId || '').trim();
    const messageId = String(body.messageId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,1500}$/.test(orderId) || !/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) {
        return response.status(400).json({ error: 'invalid-request' });
    }

    try {
        initializeAdmin();
        const snapshot = await getFirestore().collection('orders').doc(orderId).get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });
        const message = (Array.isArray(snapshot.data()?.chatMessages) ? snapshot.data().chatMessages : [])
            .find(item => item?.id === messageId);
        if (!message || message.deletedForAll || message.uploadStatus !== 'ready') {
            return response.status(404).json({ error: 'media-not-found' });
        }

        if (message.mediaProvider === 'vercel-blob' || (!message.mediaProvider && message.audioUrl)) {
            const url = String(message.mediaUrl || message.audioUrl || '');
            if (!url.startsWith('https://')) return response.status(404).json({ error: 'media-not-found' });
            return response.status(200).json({ url, expiresIn: 0 });
        }

        const path = String(message.mediaPath || message.audioPathname || message.media?.path || '');
        if (!path) return response.status(404).json({ error: 'media-not-found' });
        const storage = await resolveSupabaseStorage();
        const { data, error } = await storage.client.storage.from(storage.bucket).createSignedUrl(path, 60 * 60);
        if (error || !data?.signedUrl) throw new Error(error?.message || 'signed-url-failed');
        return response.status(200).json({ url: data.signedUrl, expiresIn: 3600 });
    } catch (error) {
        console.error('Chat media URL error', error?.message || error);
        return response.status(500).json({ error: 'media-url-failed' });
    }
};
