"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const redis_1 = require("../config/redis");
const KEY = (sessionId) => `support:session:${sessionId}`;
/**
 * Redis = "abhi kya chal raha hai". Short-lived conversation state: which
 * specialist agent owns this chat, what the last intent was, a message count.
 *
 * Everything expires after SESSION_TTL_SECONDS, so Redis never becomes a
 * second permanent database. History lives in PostgreSQL.
 */
let SessionService = class SessionService {
    /** In-memory fallback used when Redis is not connected. */
    memory = new Map();
    get mode() {
        return (0, redis_1.redis)() ? 'redis' : 'memory';
    }
    async getOrCreate(sessionId) {
        const id = sessionId ?? (0, crypto_1.randomUUID)();
        const existing = await this.get(id);
        if (existing)
            return existing;
        const state = {
            sessionId: id,
            currentAgent: null,
            lastIntent: null,
            messageCount: 0,
            updatedAt: Date.now(),
        };
        await this.save(state);
        return state;
    }
    async get(sessionId) {
        const client = (0, redis_1.redis)();
        if (client) {
            const raw = await client.get(KEY(sessionId));
            return raw ? JSON.parse(raw) : null;
        }
        const entry = this.memory.get(sessionId);
        if (!entry)
            return null;
        if (entry.expiresAt < Date.now()) {
            this.memory.delete(sessionId);
            return null;
        }
        return entry.value;
    }
    /** Patches and persists session state, refreshing the TTL. */
    async update(sessionId, patch) {
        const state = (await this.get(sessionId)) ?? (await this.getOrCreate(sessionId));
        const next = {
            ...state,
            ...patch,
            messageCount: state.messageCount + (patch.messageCount ?? 0),
            updatedAt: Date.now(),
        };
        await this.save(next);
        return next;
    }
    async destroy(sessionId) {
        await (0, redis_1.redis)()?.del(KEY(sessionId));
        this.memory.delete(sessionId);
        logger_1.logger.debug(`Session destroyed: ${sessionId}`);
    }
    async save(state) {
        const client = (0, redis_1.redis)();
        if (client) {
            await client.set(KEY(state.sessionId), JSON.stringify(state), 'EX', env_1.env.SESSION_TTL_SECONDS);
            return;
        }
        this.memory.set(state.sessionId, {
            value: state,
            expiresAt: Date.now() + env_1.env.SESSION_TTL_SECONDS * 1000,
        });
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)()
], SessionService);
//# sourceMappingURL=session.service.js.map