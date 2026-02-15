/**
 * @fileoverview Redis connection configuration for BullMQ.
 *
 * Creates a singleton Redis connection (via ioredis) used by BullMQ
 * for job queues (timer processing, scheduled tasks).
 *
 * The connection is lazy — if ENABLE_SCHEDULERS is false, no Redis
 * connection is attempted, allowing the server to run without Redis.
 *
 * @module config/redis
 */

import IORedis from 'ioredis';
import type { Redis } from 'ioredis';
import { env } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('redis');

let _redis: Redis | null = null;

/**
 * Get the singleton ioredis connection for BullMQ.
 * Returns null if ENABLE_SCHEDULERS is false.
 */
export function getRedis(): Redis | null {
  if (!env.ENABLE_SCHEDULERS) return null;

  if (!_redis) {
    _redis = new (IORedis as any)(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false, // Recommended for BullMQ
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        log.warn({ attempt: times, delayMs: delay }, 'Redis reconnection attempt');
        return delay;
      },
    });

    _redis!.on('connect', () => {
      log.info('Redis connected');
    });

    _redis!.on('error', (err: Error) => {
      log.error({ err }, 'Redis connection error');
    });

    _redis!.on('close', () => {
      log.warn('Redis connection closed');
    });
  }

  return _redis;
}

/** @deprecated Use getRedis() instead — kept for backward compatibility */
export const redis = env.ENABLE_SCHEDULERS
  ? new (IORedis as any)(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        log.warn({ attempt: times, delayMs: delay }, 'Redis reconnection attempt');
        return delay;
      },
    })
  : null;

if (redis) {
  redis.on('connect', () => log.info('Redis connected'));
  redis.on('error', (err: Error) => log.error({ err }, 'Redis connection error'));
  redis.on('close', () => log.warn('Redis connection closed'));
}

/**
 * Gracefully disconnect Redis.
 * Called during application shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  const conn = _redis ?? redis;
  if (!conn) return;
  try {
    await conn.quit();
    log.info('Redis disconnected gracefully');
  } catch (err) {
    log.error({ err }, 'Error during Redis disconnect');
  }
}
