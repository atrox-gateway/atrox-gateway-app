// /opt/atrox-gateway/packages/backend/shared-libraries/redisClient.js

const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const client = createClient({ url: REDIS_URL });

client.on('error', (err) => { console.error('Redis Client Error', err); });

client.connect()
    .then(() => console.log('✅ Redis connected successfully'))
    .catch((err) => { console.error('❌ Failed to connect to Redis:', err); });

module.exports = client;