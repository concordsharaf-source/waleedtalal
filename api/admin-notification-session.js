'use strict';

const {
    clearAdminSessionCookie,
    isAdminRequest,
    setAdminSessionCookie,
    verifyAccessCode
} = require('../server/admin-auth');

function parseBody(request) {
    if (request.body && typeof request.body === 'object') return request.body;
    try { return JSON.parse(String(request.body || '{}')); } catch { return {}; }
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (request.method === 'GET') {
        return response.status(200).json({ authenticated: isAdminRequest(request) });
    }

    if (request.method === 'POST') {
        const body = parseBody(request);
        if (!verifyAccessCode(body.password)) {
            return response.status(401).json({ error: 'invalid-admin-password' });
        }
        try {
            setAdminSessionCookie(response);
            return response.status(200).json({ authenticated: true });
        } catch (error) {
            console.error('Admin session setup error', error?.message || error);
            return response.status(503).json({ error: 'admin-session-unavailable' });
        }
    }

    if (request.method === 'DELETE') {
        clearAdminSessionCookie(response);
        return response.status(200).json({ authenticated: false });
    }

    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ error: 'method-not-allowed' });
};
