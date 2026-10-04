'use strict';

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
    const bucket = String(process.env.SUPABASE_CHAT_BUCKET || 'media file').trim();
    const blobConfigured = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim());
    const supabaseConfigured = Boolean(url && serviceKey && bucket);

    if (!supabaseConfigured) {
        return response.status(200).json({
            preferredProvider: blobConfigured ? 'vercel-blob' : null,
            supabaseConfigured: false,
            bucketReachable: false,
            signedUploadsReady: false,
            blobConfigured
        });
    }

    try {
        const supabase = createClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        const { data, error } = await supabase.storage.getBucket(bucket);
        return response.status(200).json({
            preferredProvider: error ? (blobConfigured ? 'vercel-blob' : 'supabase') : 'supabase',
            supabaseConfigured: true,
            bucketReachable: !error && Boolean(data),
            bucketPrivate: !error && data ? data.public !== true : null,
            signedUploadsReady: Boolean(anonKey) && !error && Boolean(data),
            blobConfigured,
            error: error ? 'bucket-unreachable' : null
        });
    } catch {
        return response.status(200).json({
            preferredProvider: blobConfigured ? 'vercel-blob' : 'supabase',
            supabaseConfigured: true,
            bucketReachable: false,
            bucketPrivate: null,
            signedUploadsReady: false,
            blobConfigured,
            error: 'bucket-check-failed'
        });
    }
};
