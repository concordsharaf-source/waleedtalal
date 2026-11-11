'use strict';

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { isAdminRequest } = require('../server/admin-auth');

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

function timestampToIso(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
}

function notificationJson(snapshot) {
    const data = snapshot.data() || {};
    return {
        id: snapshot.id,
        eventType: String(data.eventType || ''),
        title: String(data.title || ''),
        body: String(data.body || ''),
        url: String(data.url || ''),
        orderId: String(data.orderId || ''),
        transactionId: String(data.transactionId || ''),
        conversationId: String(data.conversationId || ''),
        sourceId: String(data.sourceId || ''),
        unread: data.unread !== false,
        createdAt: timestampToIso(data.createdAt),
        readAt: timestampToIso(data.readAt)
    };
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (!isAdminRequest(request)) {
        return response.status(401).json({ error: 'admin-auth-required' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const collection = database.collection('adminNotifications');

        if (request.method === 'GET') {
            const requestedLimit = Number.parseInt(String(request.query?.limit || '100'), 10);
            const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 200));
            const snapshot = await collection.orderBy('createdAt', 'desc').limit(limit).get();
            const notifications = snapshot.docs.map(notificationJson);
            const unreadCount = notifications.reduce((count, item) => count + (item.unread ? 1 : 0), 0);
            return response.status(200).json({ notifications, unreadCount });
        }

        if (request.method === 'POST') {
            const body = parseBody(request);
            const action = body.action === 'mark-all-read' ? 'mark-all-read' : 'mark-read';
            let documents = [];
            if (action === 'mark-all-read') {
                const unreadSnapshot = await collection.where('unread', '==', true).limit(500).get();
                documents = unreadSnapshot.docs;
            } else {
                const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id])
                    .map(value => String(value || '').trim())
                    .filter(value => /^[a-f0-9]{64}$/.test(value)))]
                    .slice(0, 200);
                if (!ids.length) return response.status(400).json({ error: 'invalid-notification-ids' });
                documents = ids.map(id => ({ ref: collection.doc(id) }));
            }

            if (documents.length) {
                const batch = database.batch();
                documents.forEach(document => batch.set(document.ref, {
                    unread: false,
                    readAt: FieldValue.serverTimestamp()
                }, { merge: true }));
                await batch.commit();
            }
            return response.status(200).json({ updated: documents.length });
        }

        response.setHeader('Allow', 'GET, POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    } catch (error) {
        console.error('Admin notifications API error', error?.message || error);
        return response.status(500).json({ error: 'admin-notifications-failed' });
    }
};
