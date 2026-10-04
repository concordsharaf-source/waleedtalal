'use strict';

const crypto = require('crypto');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const formidable = require('formidable');

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = /^(audio\/(webm|mpeg|mp4|ogg|wav)|video\/(webm|mp4|quicktime|ogg)|image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain)$/i;
const BUCKET = 'media file';

function initializeAdmin() {
    if (getApps().length) return;
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) throw new Error('service-account-not-configured');
    const account = JSON.parse(raw);
    account.private_key = String(account.private_key || '').replace(/\\n/g, '\n');
    initializeApp({ credential: cert(account) });
}

function parseForm(request) {
    const form = formidable({
        multiples: false,
        maxFileSize: MAX_BYTES,
        maxFields: 4,
        allowEmptyFiles: false
    });
    return new Promise((resolve, reject) => form.parse(request, (error, fields, files) => error ? reject(error) : resolve({ fields, files })));
}

function one(value) {
    return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    let uploadedPath = '';
    try {
        const { fields, files } = await parseForm(request);
        const orderId = String(one(fields.orderId) || '').trim();
        const actor = String(one(fields.actor) || '').trim();
        const file = one(files.file);
        if (!/^[A-Za-z0-9_-]{1,1500}$/.test(orderId) || !['client', 'admin'].includes(actor) || !file) {
            return response.status(400).json({ error: 'invalid-request' });
        }
        const mime = String(file.mimetype || 'application/octet-stream');
        if (!ALLOWED_TYPES.test(mime) || file.size > MAX_BYTES) {
            return response.status(413).json({ error: 'file-type-or-size-not-allowed' });
        }

        initializeAdmin();
        const snapshot = await getFirestore().collection('orders').doc(orderId).get();
        if (!snapshot.exists) return response.status(404).json({ error: 'order-not-found' });

        const extension = String(file.originalFilename || 'bin').split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
        uploadedPath = `chat/${orderId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
        const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
        const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
        if (!serviceKey || !supabaseUrl) throw new Error('supabase-not-configured');

        const data = require('fs').readFileSync(file.filepath);
        const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(BUCKET)}/${uploadedPath}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
                'Content-Type': mime,
                'x-upsert': 'false'
            },
            body: data
        });
        if (!uploadResponse.ok) {
            console.error('Supabase upload failed', uploadResponse.status);
            return response.status(502).json({ error: 'media-upload-failed' });
        }

        const signedResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}/${uploadedPath}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 })
        });
        if (!signedResponse.ok) {
            console.error('Supabase signed URL failed', signedResponse.status);
            return response.status(502).json({ error: 'media-url-failed' });
        }
        const signedData = await signedResponse.json();
        const signedPath = signedData.signedURL || signedData.signedUrl || signedData.path;
        if (!signedPath) return response.status(502).json({ error: 'media-url-failed' });

        return response.status(200).json({
            path: uploadedPath,
            url: signedPath.startsWith('http') ? signedPath : `${supabaseUrl}/storage/v1${signedPath}`,
            mimeType: mime,
            size: file.size,
            name: String(file.originalFilename || 'attachment').slice(0, 180)
        });
    } catch (error) {
        console.error('Media upload error', error?.message || error);
        const message = String(error?.message || '');
        if (message.includes('maxFileSize')) return response.status(413).json({ error: 'file-too-large' });
        if (message === 'service-account-not-configured' || message === 'supabase-not-configured') {
            return response.status(503).json({ error: 'media-storage-not-configured' });
        }
        return response.status(500).json({ error: 'media-upload-failed' });
    }
};
