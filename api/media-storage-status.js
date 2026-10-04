'use strict';

const {
    mediaStorageCredentials,
    hasSupabaseCredentials,
    resolveSupabaseStorage
} = require('../server/media-storage');

module.exports = async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'method-not-allowed' });
    }

    const credentials = mediaStorageCredentials();
    const blobConfigured = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim());
    if (!hasSupabaseCredentials()) {
        return response.status(200).json({
            preferredProvider: blobConfigured ? 'vercel-blob' : null,
            supabaseConfigured: false,
            bucketReachable: false,
            signedUploadsReady: false,
            blobConfigured
        });
    }

    try {
        const storage = await resolveSupabaseStorage();
        return response.status(200).json({
            preferredProvider: 'supabase',
            supabaseConfigured: true,
            bucketReachable: true,
            bucketPrivate: storage.bucketPublic !== true,
            signedUploadsReady: Boolean(credentials.anonKey),
            blobConfigured
        });
    } catch (error) {
        return response.status(200).json({
            preferredProvider: blobConfigured ? 'vercel-blob' : 'supabase',
            supabaseConfigured: true,
            bucketReachable: false,
            bucketPrivate: null,
            signedUploadsReady: false,
            blobConfigured,
            availableBuckets: Array.isArray(error?.availableBuckets) ? error.availableBuckets : [],
            error: error?.message === 'supabase-bucket-not-found' ? 'bucket-unreachable' : 'bucket-check-failed'
        });
    }
};
