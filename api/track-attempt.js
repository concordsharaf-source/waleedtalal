'use strict';

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { publishAdminNotification } = require('../server/admin-notifications');

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

function normalizeNumber(value) {
    return String(value ?? '')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[^0-9]/g, '');
}

function normalizePhone(value) {
    const phone = normalizeNumber(value);
    return phone.startsWith('00') ? phone.slice(2) : phone;
}

function clean(value, maxLength) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLength);
}

async function transactionCandidates(database, transactionId) {
    const exact = await database.collection('orders').where('transactionId', '==', transactionId).get();
    if (!exact.empty) return exact.docs;
    const all = await database.collection('orders').get();
    return all.docs.filter(document => normalizeNumber(document.data()?.transactionId) === transactionId);
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const body = parseBody(request);
    const transactionId = normalizeNumber(body.transactionId).slice(0, 80);
    const phone = normalizePhone(body.phone).slice(0, 30);
    const attemptId = clean(body.attemptId, 100);
    if (!transactionId || !phone || !/^[A-Za-z0-9_-]{10,100}$/.test(attemptId)) {
        return response.status(400).json({ error: 'invalid-tracking-attempt' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const candidates = await transactionCandidates(database, transactionId);
        const matchedDocument = candidates.find(document => normalizePhone(document.data()?.phone) === phone) || null;
        const logDocument = matchedDocument || candidates[0] || null;
        const successful = Boolean(matchedDocument);
        const now = new Date().toISOString();
        const logEntry = {
            id: attemptId,
            result: successful ? 'success' : 'failed',
            clientTime: now,
            source: 'track.html',
            device: clean(body.device, 80) || 'غير معروف',
            browser: clean(body.browser, 80) || 'غير معروف',
            os: clean(body.os, 80) || 'غير معروف',
            language: clean(body.language, 20) || 'غير معروف',
            screen: clean(body.screen, 30) || 'غير معروف',
            userAgent: clean(body.userAgent, 500)
        };

        if (logDocument) {
            await database.runTransaction(async transaction => {
                const latestSnapshot = await transaction.get(logDocument.ref);
                if (!latestSnapshot.exists) return;
                const latest = latestSnapshot.data() || {};
                const previousLogs = Array.isArray(latest.trackingLogs) ? latest.trackingLogs.slice(-49) : [];
                if (previousLogs.some(item => item?.id === attemptId)) return;
                const changes = {
                    trackingAttemptCount: FieldValue.increment(1),
                    trackingLogs: [...previousLogs, logEntry],
                    lastTrackingAccessAt: FieldValue.serverTimestamp()
                };
                if (successful) {
                    changes.trackingSuccessCount = FieldValue.increment(1);
                    changes.lastTrackingSuccessAt = FieldValue.serverTimestamp();
                } else {
                    changes.trackingFailedCount = FieldValue.increment(1);
                    changes.lastTrackingFailedAt = FieldValue.serverTimestamp();
                }
                transaction.update(logDocument.ref, changes);
            });
        }

        const orderId = logDocument?.id || '';
        await publishAdminNotification({
            dedupeKey: `tracking:${attemptId}`,
            eventType: successful ? 'tracking-success' : 'tracking-failed',
            title: successful ? 'دخول جديد عبر صفحة التتبع' : 'محاولة تتبع غير ناجحة',
            body: successful
                ? `تم الدخول بنجاح إلى المعاملة رقم ${transactionId} عبر صفحة التتبع.`
                : `تمت محاولة دخول غير ناجحة باستخدام رقم المعاملة ${transactionId}.`,
            url: `https://waleedtalal.vercel.app/pages/notifications.html?type=tracking${orderId ? `&order=${encodeURIComponent(orderId)}` : ''}`,
            orderId,
            transactionId,
            sourceId: attemptId
        }).catch(error => console.warn('Tracking admin notification failed', error?.message || error));

        const matchedOrder = matchedDocument?.data() || {};
        return response.status(200).json({
            matched: successful,
            orderId: matchedDocument?.id || '',
            transactionId,
            name: successful ? clean(matchedOrder.name, 120) : ''
        });
    } catch (error) {
        console.error('Tracking attempt error', error?.message || error);
        return response.status(500).json({ error: 'tracking-attempt-failed' });
    }
};
