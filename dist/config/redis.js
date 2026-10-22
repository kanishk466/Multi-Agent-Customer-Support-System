"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRedis = initRedis;
exports.redis = redis;
exports.redisAvailable = redisAvailable;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = require("../common/logger");
/**
 * Redis = "abhi kya chal raha hai" (temporary, RAM).
 *
 * The server boots fine without Redis - sessionService falls back to an
 * in-memory Map so you can learn the flow before wiring up infrastructure.
 */
let client = null;
let available = false;
async function initRedis() {
    if (!env_1.env.REDIS_URL) {
        logger_1.logger.warn('REDIS_URL not set - session store: in-memory');
        return null;
    }
    client = new ioredis_1.default(env_1.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        // Do not crash the whole server because Redis blinked.
        retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    client.on('error', (err) => {
        if (available)
            logger_1.logger.warn(`Redis error: ${err.message}`);
        available = false;
    });
    client.on('ready', () => {
        available = true;
        logger_1.logger.info('Redis connected');
    });
    try {
        await client.connect();
        await client.ping();
        available = true;
        return client;
    }
    catch (err) {
        logger_1.logger.warn(`Redis unavailable (${err.message}) - session store: in-memory`);
        available = false;
        client = null;
        return null;
    }
}
function redis() {
    return available && client ? client : null;
}
function redisAvailable() {
    return redis() !== null;
}
//# sourceMappingURL=redis.js.map