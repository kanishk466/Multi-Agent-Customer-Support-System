import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../common/logger';

/**
 * Redis = "abhi kya chal raha hai" (temporary, RAM).
 *
 * The server boots fine without Redis - sessionService falls back to an
 * in-memory Map so you can learn the flow before wiring up infrastructure.
 */
let client: Redis | null = null;
let available = false;

export async function initRedis(): Promise<Redis | null> {
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL not set - session store: in-memory');
    return null;
  }

  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Do not crash the whole server because Redis blinked.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  client.on('error', (err) => {
    if (available) logger.warn(`Redis error: ${err.message}`);
    available = false;
  });
  client.on('ready', () => {
    available = true;
    logger.info('Redis connected');
  });

  try {
    await client.connect();
    await client.ping();
    available = true;
    return client;
  } catch (err) {
    logger.warn(`Redis unavailable (${(err as Error).message}) - session store: in-memory`);
    available = false;
    client = null;
    return null;
  }
}

export function redis(): Redis | null {
  return available && client ? client : null;
}

export function redisAvailable(): boolean {
  return redis() !== null;
}
