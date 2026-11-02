'use strict';

const crypto = require('crypto');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/* منطق منع التكرار: رفض فقط عند تطابق خانتين على الأقل (تطابق تام). */
const {
    REQUIRED_NAME_PARTS,
    DUPLICATE_THRESHOLD,
    FIELD_LABELS,
    limitText,
    normalizeDigits,
    normalizeTripleName,
    countMeaningfulNameParts,
    normalizePhone,
    normalizePhoneKey,
    normalizeIdentifier,
    collectDuplicateFields,
    duplicateRejectionMessage
} = require('../lib/registration-duplicate');

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

function parseBody(request) {
    if (request.body && typeof request.body === 'object') return request.body;
    try { return JSON.parse(String(request.body || '{}')); } catch { return {}; }
}

function keyHash(type, value) {
    return crypto.createHash('sha256').update(`${type}:${value}`).digest('hex');
}

/**
 * مفاتيح القفل — تُحفظ في مجموعة orderRegistrationKeys بنفس الصيغة القديمة
 * حتى يبقى التوافق مع السجلات السابقة.
 *
 * ملاحظة: بصمة الاسم كانت تُحفظ لأول **اسمين** في السجلات القديمة، لذلك
 * نحسب لكل شكل من أشكال الاسم (الكامل / أول اسمين) ونستخدم أول اسمين في
 * مفتاح القفل — بينما قرار الرفض نفسه يعتمد على التطابق التام للاسم.
 */
function registrationKeys(data) {
    const nameWords = normalizeTripleName(data.name).split(' ').filter(Boolean);
    const nameKey = nameWords.slice(0, Math.min(2, nameWords.length)).join(' ');
    return [
        { field: 'name', type: 'name', value: nameKey },
        { field: 'phone', type: 'phone', value: normalizePhoneKey(data.phone) },
        { field: 'idNumber', type: 'id', value: normalizeIdentifier(data.idNumber) },
        { field: 'bankAccount', type: 'bank', value: normalizeIdentifier(data.partNumber) }
    ].filter(item => item.value);
}

/**
 * رفض فقط عند تطابق خانتين على الأقل (الاسم / الجوال / الحساب / الهوية)
 * مع نفس السجل — وتطابق تام بعد التوحيد.
 */
function existingDuplicateFields(snapshot, order) {
    const orders = [];
    snapshot.forEach(document => orders.push({ id: document.id, ...document.data() }));
    return collectDuplicateFields(orders, order);
}

function makeWelcomeMessage(order, transactionId) {
    const welcomeText =
        `📋 تفاصيل الطلب المقدم (#${transactionId}):\n` +
        `👤 المستفيد: ${order.name}\n` +
        `🆔 رقم الهوية: ${order.idNumber || 'غير محدد'}\n` +
        `🌍 الدولة: ${order.country}\n` +
        `📞 رقم الهاتف: ${order.phone}\n` +
        `✉️ البريد الإلكتروني: ${order.email || 'غير محدد'}\n` +
        `🏦 اسم البنك: ${order.bankName || 'غير محدد'}\n` +
        `💳 رقم الحساب/الآيبان: ${order.partNumber || 'غير محدد'}\n` +
        `📂 نوع الطلب: ${order.type}\n` +
        `📝 شرح الاحتياج: ${order.notes || 'غير محدد'}\n` +
        '📍 حالة الطلب: قيد المراجعة\n' +
        '✅ حالة الاعتماد: غير معتمد\n' +
        '💰 مبلغ المنحة: غير محدد\n' +
        `🗓️ تاريخ تقديم الطلب: ${new Date().toLocaleString('ar-SA-u-ca-gregory')}\n\n` +
        'مرحباً بك عزيزي المستفيد، تم استلام طلبك بنجاح. يمكنك التواصل المباشر مع إدارة المؤسسة هنا لمتابعة تفاصيل وإجراءات طلبك.';
    return {
        welcomeText,
        message: {
            id: crypto.randomUUID(),
            senderId: 'admin',
            senderName: 'إدارة المؤسسة',
            text: welcomeText,
            clientTime: new Date().toISOString(),
            messageType: 'text',
            replyTo: null,
            deliveredBy: [],
            readBy: [],
            deletedFor: [],
            deletedForAll: false,
            starredBy: []
        }
    };
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const body = parseBody(request);
    const order = {
        name: limitText(body.name, 180),
        phone: normalizePhone(body.phone),
        email: limitText(body.email, 180),
        idNumber: limitText(body.idNumber, 100),
        partNumber: limitText(body.partNumber, 120),
        bankName: limitText(body.bankName, 120),
        country: limitText(body.country, 120),
        type: limitText(body.type, 100),
        notes: limitText(body.notes, 2500)
    };

    if (!order.name || !order.phone || !order.country || !order.type) {
        return response.status(400).json({ error: 'missing-required-fields' });
    }
    if (countMeaningfulNameParts(order.name) < REQUIRED_NAME_PARTS) {
        return response.status(400).json({ error: 'full-name-required' });
    }
    if (order.phone.length < 7 || order.phone.length > 15) {
        return response.status(400).json({ error: 'invalid-phone' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const orders = database.collection('orders');
        const keys = registrationKeys(order);

        // نفحص السجلات القديمة التي سبقت إنشاء فهرس منع التكرار.
        // الرفض فقط عند تطابق خانتين على الأقل.
        const existingOrders = await orders.get();
        const duplicate = existingDuplicateFields(existingOrders, order);
        if (duplicate.rejected) {
            return response.status(409).json({
                error: 'beneficiary-already-registered',
                duplicateFields: duplicate.fields,
                duplicateCount: duplicate.fields.length,
                duplicateLabels: duplicate.fields.map(field => FIELD_LABELS[field] || field),
                message: duplicateRejectionMessage(duplicate.fields)
            });
        }

        const transactionId = String(Math.floor(1000 + Math.random() * 9000));
        const orderRef = orders.doc();
        const lockCollection = database.collection('orderRegistrationKeys');
        const lockEntries = keys.map(key => ({
            ...key,
            ref: lockCollection.doc(keyHash(key.type, key.value))
        }));
        const { welcomeText, message } = makeWelcomeMessage(order, transactionId);

        await database.runTransaction(async transaction => {
            const lockSnapshots = await Promise.all(lockEntries.map(entry => transaction.get(entry.ref)));
            const lockedFields = lockSnapshots
                .map((snapshot, index) => snapshot.exists ? lockEntries[index].field : '')
                .filter(Boolean);

            /* رفض فقط عند تطابق خانتين على الأقل — خانة واحدة ليست تكراراً. */
            if (new Set(lockedFields).size >= DUPLICATE_THRESHOLD) {
                const duplicate = new Error('beneficiary-already-registered');
                duplicate.code = 'beneficiary-already-registered';
                duplicate.duplicateFields = [...new Set(lockedFields)];
                throw duplicate;
            }

            transaction.create(orderRef, {
                transactionId,
                ...order,
                status: 'قيد المراجعة',
                approved: false,
                createdAt: FieldValue.serverTimestamp(),
                chatEnabled: true,
                chatMessages: [message],
                chatLastMessage: welcomeText,
                chatLastSender: 'admin',
                chatUpdatedAt: FieldValue.serverTimestamp(),
                chatOnline: { admin: false, client: false },
                chatTyping: { admin: false, client: false },
                registrationKeyHashes: Object.fromEntries(keys.map(key => [key.field, keyHash(key.type, key.value)]))
            });
            /* قفل الخانات: set+merge حتى لا يفشل الطلب إذا كان القفل موجوداً
               بخانة واحدة فقط (وهي حالة مسموحة بالقاعدة الجديدة). */
            lockEntries.forEach(entry => transaction.set(entry.ref, {
                orderId: orderRef.id,
                field: entry.field,
                createdAt: FieldValue.serverTimestamp()
            }, { merge: true }));
        });

        return response.status(201).json({
            created: true,
            orderId: orderRef.id,
            transactionId,
            name: order.name,
            phone: order.phone
        });
    } catch (error) {
        if (error?.code === 'beneficiary-already-registered') {
            const fields = error.duplicateFields || [];
            return response.status(409).json({
                error: 'beneficiary-already-registered',
                duplicateFields: fields,
                duplicateCount: fields.length,
                duplicateLabels: fields.map(field => FIELD_LABELS[field] || field),
                message: duplicateRejectionMessage(fields)
            });
        }
        console.error('Register order error', error?.message || error);
        return response.status(500).json({ error: 'order-registration-failed' });
    }
};
