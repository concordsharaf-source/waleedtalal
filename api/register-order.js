'use strict';

const crypto = require('crypto');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REQUIRED_NAME_PARTS = 3;
const NAME_CONNECTORS = new Set(['بن', 'ابن', 'بنت']);

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

function limitText(value, maxLength) {
    return String(value ?? '').normalize('NFKC').trim().slice(0, maxLength);
}

function normalizeDigits(value) {
    return String(value ?? '')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeArabicText(value) {
    return limitText(value, 220)
        .toLocaleLowerCase('ar')
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
        .replace(/ـ/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTripleName(value) {
    const meaningfulParts = normalizeArabicText(value)
        .split(' ')
        .filter(part => part && !NAME_CONNECTORS.has(part));
    return meaningfulParts.slice(0, REQUIRED_NAME_PARTS).join(' ');
}

function countMeaningfulNameParts(value) {
    return normalizeArabicText(value)
        .split(' ')
        .filter(part => part && !NAME_CONNECTORS.has(part)).length;
}

function normalizePhone(value) {
    const digits = normalizeDigits(value).replace(/[^0-9]/g, '');
    return digits.startsWith('00') ? digits.slice(2) : digits;
}

function normalizePhoneKey(value) {
    const phone = normalizePhone(value);
    return phone.length >= 9 ? phone.slice(-9) : phone;
}

function normalizeIdentifier(value) {
    return normalizeDigits(value)
        .normalize('NFKC')
        .toLocaleUpperCase('en')
        .replace(/[^\p{L}\p{N}]/gu, '');
}

function keyHash(type, value) {
    return crypto.createHash('sha256').update(`${type}:${value}`).digest('hex');
}

function registrationKeys(data) {
    return [
        { field: 'name', type: 'name', value: normalizeTripleName(data.name) },
        { field: 'phone', type: 'phone', value: normalizePhoneKey(data.phone) },
        { field: 'idNumber', type: 'id', value: normalizeIdentifier(data.idNumber) },
        { field: 'bankAccount', type: 'bank', value: normalizeIdentifier(data.partNumber) }
    ].filter(item => item.value);
}

function existingDuplicateFields(snapshot, incomingKeys) {
    const duplicates = new Set();
    snapshot.forEach(document => {
        const data = document.data() || {};
        for (const key of incomingKeys) {
            const existingValue = key.type === 'name' ? normalizeTripleName(data.name)
                : key.type === 'phone' ? normalizePhoneKey(data.phone)
                    : key.type === 'id' ? normalizeIdentifier(data.idNumber)
                        : normalizeIdentifier(data.partNumber);
            if (existingValue && existingValue === key.value) duplicates.add(key.field);
        }
    });
    return [...duplicates];
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
        const existingOrders = await orders.get();
        const duplicateFields = existingDuplicateFields(existingOrders, keys);
        if (duplicateFields.length) {
            return response.status(409).json({
                error: 'beneficiary-already-registered',
                duplicateFields
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
            if (lockedFields.length) {
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
            lockEntries.forEach(entry => transaction.create(entry.ref, {
                orderId: orderRef.id,
                field: entry.field,
                createdAt: FieldValue.serverTimestamp()
            }));
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
            return response.status(409).json({
                error: 'beneficiary-already-registered',
                duplicateFields: error.duplicateFields || []
            });
        }
        console.error('Register order error', error?.message || error);
        return response.status(500).json({ error: 'order-registration-failed' });
    }
};
