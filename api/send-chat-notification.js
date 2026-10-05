'use strict';

const crypto = require('crypto');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

function parseServiceAccount() {
    const rawValue = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!rawValue) throw new Error('service-account-not-configured');

    let raw = rawValue;
    if (!raw.startsWith('{')) {
        try {
            raw = Buffer.from(raw, 'base64').toString('utf8');
        } catch {
            throw new Error('invalid-service-account');
        }
    }

    let account = JSON.parse(raw);
    if (typeof account === 'string') account = JSON.parse(account);
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
    if (!account.project_id || !account.client_email || !account.private_key) {
        throw new Error('invalid-service-account');
    }
    return account;
}

function initializeAdmin() {
    if (getApps().length) return;
    initializeApp({ credential: cert(parseServiceAccount()) });
}

function parseBody(request) {
    if (request.body && typeof request.body === 'object') return request.body;
    if (typeof request.body === 'string') {
        try { return JSON.parse(request.body); } catch { return {}; }
    }
    return {};
}

function tokenRecords(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => typeof item === 'string' ? { token: item } : item)
        .filter(item => item && typeof item.token === 'string' && item.token.length > 40);
}

function isInvalidTokenError(code) {
    return [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
        'messaging/invalid-argument'
    ].includes(code);
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const body = parseBody(request);
    const orderId = String(body.orderId || '').trim();
    const senderId = body.senderId === 'admin' ? 'admin' : body.senderId === 'client' ? 'client' : '';
    const messageId = String(body.messageId || '').trim();

    if (!orderId || !senderId || !messageId || !/^[A-Za-z0-9_-]{1,1500}$/.test(orderId)) {
        return response.status(400).json({ error: 'invalid-request' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const orderRef = database.collection('orders').doc(orderId);
        const snapshot = await orderRef.get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });

        const order = snapshot.data() || {};
        const messages = Array.isArray(order.chatMessages) ? order.chatMessages : [];
        const message = messages.find(item => item && item.id === messageId && item.senderId === senderId);
        if (!message) return response.status(409).json({ error: 'message-not-found' });

        const serverUpdateTime = typeof order.chatUpdatedAt?.toMillis === 'function'
            ? order.chatUpdatedAt.toMillis()
            : 0;
        if (!serverUpdateTime || Math.abs(Date.now() - serverUpdateTime) > 10 * 60 * 1000) {
            return response.status(409).json({ error: 'message-expired' });
        }

        const recipientRole = senderId === 'admin' ? 'client' : 'admin';
        const records = tokenRecords(order.chatPushTokens?.[recipientRole]);
        const tokens = [...new Set(records.map(item => item.token))].slice(0, 500);
        if (!tokens.length) {
            return response.status(200).json({ sent: 0, failed: 0, reason: 'no-recipient-tokens' });
        }

        const title = senderId === 'admin'
            ? 'رسالة جديدة من إدارة المؤسسة'
            : `رسالة جديدة من ${String(order.name || 'مستفيد').slice(0, 80)}`;
        const bodyText = String(message.text || 'رسالة جديدة').replace(/\s+/g, ' ').trim().slice(0, 180);
        const url = senderId === 'admin'
            ? `https://waleedtalal.vercel.app/pages/chat.html?notification=${encodeURIComponent(messageId)}`
            : `https://waleedtalal.vercel.app/pages/admin-chat.html?order=${encodeURIComponent(orderId)}&notification=${encodeURIComponent(messageId)}`;

        // نرسل بيانات فقط، ثم يعرض عامل الخدمة الإشعار بنفسه. هذا أكثر ثباتًا
        // في Chrome وSamsung عند وجود التطبيق في الخلفية أو إغلاقه بالكامل،
        // ويضمن أن كل جهاز مسجل يعرض كل رسالة بدل الاعتماد على العرض التلقائي.
        const result = await getMessaging().sendEachForMulticast({
            tokens,
            data: {
                type: 'chat-message',
                title,
                body: bodyText,
                url,
                orderId,
                messageId,
                senderId
            },
            webpush: {
                headers: {
                    Urgency: 'high',
                    TTL: '86400'
                }
            }
        });

        const invalidTokens = new Set();
        result.responses.forEach((item, index) => {
            if (!item.success && isInvalidTokenError(item.error?.code)) invalidTokens.add(tokens[index]);
        });

        if (invalidTokens.size) {
            // نظّف الرموز التالفة من أحدث نسخة للطلب داخل معاملة؛ بهذه الطريقة
            // لا يمكن لتنظيف رمز قديم أن يمسح جهازًا جديدًا سُجّل أثناء الإرسال.
            try {
                await database.runTransaction(async transaction => {
                    const latestSnapshot = await transaction.get(orderRef);
                    if (!latestSnapshot.exists) return;
                    const latestRecords = tokenRecords(latestSnapshot.data()?.chatPushTokens?.[recipientRole]);
                    const cleaned = latestRecords.filter(item => !invalidTokens.has(item.token));
                    if (cleaned.length !== latestRecords.length) {
                        transaction.update(orderRef, { [`chatPushTokens.${recipientRole}`]: cleaned });
                    }
                });
            } catch (cleanupError) {
                console.warn('Invalid token cleanup failed', cleanupError?.message || cleanupError);
            }
        }

        // نجاح FCM يعني أن الرسالة قُبلت لجهاز الطرف الآخر؛ نظهر عندها
        // علامتي تسليم رماديتين فوراً، ثم يحولهما فتح المحادثة إلى أزرق.
        if (result.successCount > 0) {
            try {
                await database.runTransaction(async transaction => {
                    const latestSnapshot = await transaction.get(orderRef);
                    if (!latestSnapshot.exists) return;
                    let changed = false;
                    const latestMessages = Array.isArray(latestSnapshot.data()?.chatMessages)
                        ? latestSnapshot.data().chatMessages
                        : [];
                    const nextMessages = latestMessages.map(item => {
                        if (!item || item.id !== messageId || item.senderId !== senderId) return item;
                        const deliveredBy = Array.isArray(item.deliveredBy) ? item.deliveredBy : [];
                        if (deliveredBy.includes(recipientRole)) return item;
                        changed = true;
                        return { ...item, deliveredBy: [...deliveredBy, recipientRole] };
                    });
                    if (changed) transaction.update(orderRef, { chatMessages: nextMessages });
                });
            } catch (deliveryError) {
                console.warn('Delivery receipt update failed', deliveryError?.message || deliveryError);
            }
        }

        const requestId = crypto.randomBytes(6).toString('hex');
        return response.status(200).json({
            targeted: tokens.length,
            sent: result.successCount,
            failed: result.failureCount,
            removedInvalidTokens: invalidTokens.size,
            requestId
        });
    } catch (error) {
        console.error('Push notification error', error?.message || error);
        const configurationError = [
            'service-account-not-configured',
            'invalid-service-account'
        ].includes(error?.message);
        return response.status(configurationError ? 503 : 500).json({
            error: configurationError ? 'push-server-not-configured' : 'push-send-failed'
        });
    }
};
