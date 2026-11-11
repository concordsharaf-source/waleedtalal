'use strict';

const crypto = require('crypto');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

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

function ensureAdmin() {
    if (!getApps().length) initializeApp({ credential: cert(parseServiceAccount()) });
}

function cleanText(value, maxLength = 180) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isInvalidTokenError(code) {
    return [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
        'messaging/invalid-argument'
    ].includes(code);
}

async function publishAdminNotification({
    dedupeKey,
    eventType,
    title,
    body,
    url,
    orderId = '',
    transactionId = '',
    conversationId = '',
    sourceId = '',
    excludedTokens = [],
    excludeTokens = []
}) {
    ensureAdmin();
    const database = getFirestore();
    const normalizedKey = cleanText(dedupeKey, 500);
    if (!normalizedKey) throw new Error('notification-dedupe-key-required');
    const eventId = crypto.createHash('sha256').update(normalizedKey).digest('hex');
    const eventRef = database.collection('adminNotifications').doc(eventId);
    let created = false;

    await database.runTransaction(async transaction => {
        const existing = await transaction.get(eventRef);
        if (existing.exists) return;
        created = true;
        transaction.create(eventRef, {
            eventType: cleanText(eventType, 60),
            title: cleanText(title, 120),
            body: cleanText(body, 240),
            url: cleanText(url, 500),
            orderId: cleanText(orderId, 1500),
            transactionId: cleanText(transactionId, 80),
            conversationId: cleanText(conversationId, 1500),
            sourceId: cleanText(sourceId, 120),
            unread: true,
            readAt: null,
            createdAt: FieldValue.serverTimestamp(),
            clientTime: new Date().toISOString()
        });
    });

    if (!created) return { created: false, duplicate: true, eventId, targeted: 0, sent: 0, failed: 0 };

    const devicesSnapshot = await database.collection('adminNotificationDevices')
        .where('enabled', '==', true)
        .limit(500)
        .get();
    const excluded = new Set([
        ...(Array.isArray(excludedTokens) ? excludedTokens : []),
        ...(Array.isArray(excludeTokens) ? excludeTokens : [])
    ].map(String));
    const records = [];
    const seenTokens = new Set();
    devicesSnapshot.forEach(document => {
        const data = document.data() || {};
        const token = String(data.token || '');
        if (token.length <= 40 || excluded.has(token) || seenTokens.has(token)) return;
        seenTokens.add(token);
        records.push({ ref: document.ref, token });
    });
    if (!records.length) return { created: true, eventId, targeted: 0, sent: 0, failed: 0 };

    const notificationId = `${eventId.slice(0, 16)}-${Date.now().toString(36)}`;
    const result = await getMessaging().sendEachForMulticast({
        tokens: records.map(record => record.token),
        data: {
            type: 'admin-event',
            eventType: cleanText(eventType, 60),
            title: cleanText(title, 120) || 'إشعار إداري جديد',
            body: cleanText(body, 240) || 'يوجد تحديث جديد في لوحة الإدارة.',
            url: cleanText(url, 500) || '/pages/notifications.html',
            orderId: cleanText(orderId, 1500),
            transactionId: cleanText(transactionId, 80),
            eventId,
            sourceId: cleanText(sourceId, 120),
            notificationId
        },
        webpush: {
            headers: {
                Urgency: 'high',
                TTL: '86400'
            }
        }
    });

    const invalidRefs = [];
    result.responses.forEach((item, index) => {
        if (!item.success && isInvalidTokenError(item.error?.code)) invalidRefs.push(records[index].ref);
    });
    if (invalidRefs.length) {
        const batch = database.batch();
        invalidRefs.forEach(ref => batch.delete(ref));
        await batch.commit().catch(error => console.warn('Admin token cleanup failed', error?.message || error));
    }

    return {
        created: true,
        eventId,
        targeted: records.length,
        sent: result.successCount,
        failed: result.failureCount,
        removedInvalidTokens: invalidRefs.length
    };
}

module.exports = { publishAdminNotification };
