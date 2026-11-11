'use strict';

const crypto = require('crypto');
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

function clean(value, maxLength) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLength);
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    if (!isAdminRequest(request)) {
        return response.status(401).json({ error: 'admin-auth-required' });
    }

    const body = parseBody(request);
    const action = body.action === 'unregister' ? 'unregister' : 'register';
    const deviceId = clean(body.deviceId, 120);
    const token = clean(body.token, 4096);
    if (!/^[A-Za-z0-9_-]{10,120}$/.test(deviceId) || (action === 'register' && token.length <= 40)) {
        return response.status(400).json({ error: 'invalid-device-request' });
    }

    try {
        initializeAdmin();
        const database = getFirestore();
        const documentId = crypto.createHash('sha256').update(deviceId).digest('hex');
        const deviceRef = database.collection('adminNotificationDevices').doc(documentId);
        if (action === 'unregister') {
            await deviceRef.delete();
            return response.status(200).json({ enabled: false, deviceId });
        }

        await deviceRef.set({
            deviceId,
            token,
            enabled: true,
            device: clean(body.device, 80),
            browser: clean(body.browser, 80),
            os: clean(body.os, 80),
            userAgent: clean(body.userAgent, 300),
            updatedAt: FieldValue.serverTimestamp(),
            registeredAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return response.status(200).json({ enabled: true, deviceId });
    } catch (error) {
        console.error('Admin notification device error', error?.message || error);
        return response.status(500).json({ error: 'admin-notification-device-failed' });
    }
};
