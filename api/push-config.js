'use strict';

module.exports = function handler(request, response) {
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const vapidKey = String(process.env.FCM_VAPID_PUBLIC_KEY || '').trim();
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    if (!vapidKey) {
        return response.status(503).json({
            configured: false,
            error: 'push-not-configured'
        });
    }

    return response.status(200).json({
        configured: true,
        vapidKey
    });
};
