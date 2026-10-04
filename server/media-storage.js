'use strict';

const { createClient } = require('@supabase/supabase-js');

function mediaStorageCredentials() {
    return {
        url: String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, ''),
        serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
        anonKey: String(process.env.SUPABASE_ANON_KEY || '').trim(),
        requestedBucket: String(process.env.SUPABASE_CHAT_BUCKET || '').trim()
    };
}

function hasSupabaseCredentials() {
    const { url, serviceKey } = mediaStorageCredentials();
    return Boolean(url && serviceKey);
}

async function resolveSupabaseStorage() {
    const config = mediaStorageCredentials();
    if (!config.url || !config.serviceKey) throw new Error('supabase-not-configured');
    const client = createClient(config.url, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await client.storage.listBuckets();
    if (error) throw new Error(`supabase-buckets:${error.message}`);
    const buckets = Array.isArray(data) ? data : [];
    const preferredNames = [
        config.requestedBucket,
        'chat-media',
        'media file',
        'chat_media',
        'media'
    ].filter(Boolean);
    let bucket = preferredNames
        .map(name => buckets.find(item => item.name === name || item.id === name))
        .find(Boolean);
    if (!bucket && buckets.length === 1) bucket = buckets[0];
    if (!bucket) throw new Error('supabase-bucket-not-found');
    return {
        ...config,
        client,
        bucket: bucket.name || bucket.id,
        bucketPublic: bucket.public === true
    };
}

module.exports = {
    mediaStorageCredentials,
    hasSupabaseCredentials,
    resolveSupabaseStorage
};
