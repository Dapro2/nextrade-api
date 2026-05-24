const Redis = require('ioredis');

let redis;

async function connectRedis() {
  redis = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => console.error('Redis error:', err));
}

function getRedis() {
  if (!redis) throw new Error('Redis not initialised');
  return redis;
}

// Helpers
async function setCache(key, value, ttlSeconds = 60) {
  const r = getRedis();
  await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

async function getCache(key) {
  const r = getRedis();
  const val = await r.get(key);
  return val ? JSON.parse(val) : null;
}

async function delCache(key) {
  const r = getRedis();
  await r.del(key);
}

module.exports = { connectRedis, getRedis, setCache, getCache, delCache };
