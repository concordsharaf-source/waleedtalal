'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'waleed_admin_notifications';
const SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;

function accessCode() {
    return String(process.env.ADMIN_NOTIFICATION_ACCESS_CODE || '232167');
}

function signingSecret() {
    const configured = String(process.env.ADMIN_NOTIFICATION_SESSION_SECRET || '').trim();
    if (configured) return configured;
    const serviceAccount = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!serviceAccount) throw new Error('admin-session-secret-not-configured');
    return crypto.createHash('sha256').update(serviceAccount).digest('hex');
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(payload) {
    return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function createAdminSession() {
    const payload = Buffer.from(JSON.stringify({
        role: 'owner-notifications',
        exp: Date.now() + SESSION_AGE_SECONDS * 1000,
        nonce: crypto.randomBytes(12).toString('hex')
    })).toString('base64url');
    return `${payload}.${signature(payload)}`;
}

function parseCookies(request) {
    const cookieHeader = String(request.headers?.cookie || '');
    return Object.fromEntries(cookieHeader.split(';').map(part => {
        const separator = part.indexOf('=');
        if (separator < 0) return ['', ''];
        return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
    }).filter(([key]) => key));
}

function isAdminRequest(request) {
    try {
        const token = parseCookies(request)[COOKIE_NAME] || '';
        const separator = token.lastIndexOf('.');
        if (separator <= 0) return false;
        const payload = token.slice(0, separator);
        const suppliedSignature = token.slice(separator + 1);
        if (!safeEqual(suppliedSignature, signature(payload))) return false;
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return session.role === 'owner-notifications' && Number(session.exp) > Date.now();
    } catch {
        return false;
    }
}

function verifyAccessCode(value) {
    return safeEqual(String(value || ''), accessCode());
}

function setAdminSessionCookie(response) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(createAdminSession())}; Path=/; Max-Age=${SESSION_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
}

function clearAdminSessionCookie(response) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

module.exports = {
    clearAdminSessionCookie,
    isAdminRequest,
    setAdminSessionCookie,
    verifyAccessCode
};
