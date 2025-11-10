import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

const defaultTtl = parseInt(process.env.CACHE_TTL, 10) || 300; // seconds
const checkperiod = Math.max(30, Math.floor(defaultTtl / 2));

// Initialize node-cache with recommended performance options
const cache = new NodeCache({ stdTTL: defaultTtl, checkperiod, useClones: false });

// Optional simple metrics logged under debug
cache.on('expired', (key, value) => {
  logger.debug('Cache expired', { key });
});

export const KEYS = {
  CUSTOMERS_ALL: 'customers:all',
  CUSTOMER_BY_ID: (id) => `customer:${id}`,
  COLLECTIONS_ALL: (customerId) => `collections:all:${customerId || 'all'}`,
  COLLECTIONS_ALL_GLOBAL: 'collections:all:all',
  COLLECTION_BY_ID: (id) => `collection:${id}`,
  COLLECTION_STATS: (id) => `collection:${id}:stats`,
};

export const get = (key) => {
  const v = cache.get(key);
  logger.debug('Cache get', { key, hit: v !== undefined });
  return v;
};

export const set = (key, value, ttl = defaultTtl) => {
  const ok = cache.set(key, value, ttl);
  logger.debug('Cache set', { key, ttl, success: ok });
  return ok;
};

export const del = (key) => {
  const count = cache.del(key);
  logger.debug('Cache delete', { key, deleted: count });
  return count;
};

export const keys = () => cache.keys();
export const flush = () => cache.flushAll();

// getOrSet: returns cached value or computes, sets and returns it
export const getOrSet = async (key, fn, ttl = defaultTtl) => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    logger.debug('Cache hit', { key });
    return cached;
  }
  logger.debug('Cache miss', { key });
  const value = await fn();
  cache.set(key, value, ttl);
  return value;
};

// Invalidate keys matching a pattern (string includes or a RegExp)
export const invalidatePattern = (pattern) => {
  const isRegex = pattern instanceof RegExp;
  const allKeys = cache.keys();
  const matched = allKeys.filter(k => isRegex ? pattern.test(k) : k.includes(pattern));
  if (matched.length === 0) return 0;
  const deleted = cache.del(matched);
  logger.debug('Cache invalidatePattern', { pattern: String(pattern), matched: matched.length, deleted });
  return deleted;
};

export default {
  KEYS,
  get,
  set,
  del,
  keys,
  flush,
  getOrSet,
  invalidatePattern,
};
