"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryService = void 0;
const common_1 = require("@nestjs/common");
const postgres_1 = require("../config/postgres");
const env_1 = require("../config/env");
/**
 * PostgreSQL = "kya hua tha". Permanent chat history, kept far beyond the
 * Redis session TTL so a conversation can be resumed or audited later.
 *
 * In-memory fallback when DATABASE_URL is unset.
 */
let HistoryService = class HistoryService {
    memory = new Map();
    get mode() {
        return (0, postgres_1.db)() ? 'postgres' : 'memory';
    }
    async append(message) {
        const pool = (0, postgres_1.db)();
        if (pool) {
            await pool.query(`INSERT INTO messages (session_id, role, agent, content) VALUES ($1, $2, $3, $4)`, [message.sessionId, message.role, message.agent, message.content]);
            return;
        }
        const list = this.memory.get(message.sessionId) ?? [];
        list.push(message);
        // Keep the in-memory fallback bounded.
        this.memory.set(message.sessionId, list.slice(-200));
    }
    /** Most recent messages, oldest first - ready to drop straight into an LLM call. */
    async getHistory(sessionId, limit = env_1.env.MAX_HISTORY_MESSAGES) {
        const pool = (0, postgres_1.db)();
        if (pool) {
            const result = await pool.query(`SELECT role, content FROM messages
         WHERE session_id = $1 AND role <> 'system'
         ORDER BY id DESC LIMIT $2`, [sessionId, limit]);
            return result.rows
                .slice()
                .reverse()
                .map((row) => ({ role: row.role, content: row.content }));
        }
        return (this.memory.get(sessionId) ?? [])
            .slice(-limit)
            .map((message) => ({ role: message.role, content: message.content }));
    }
    async getAll(sessionId) {
        const pool = (0, postgres_1.db)();
        if (pool) {
            const result = await pool.query(`SELECT role, agent, content, created_at FROM messages
         WHERE session_id = $1 ORDER BY id ASC`, [sessionId]);
            return result.rows.map((row) => ({
                sessionId,
                role: row.role,
                agent: row.agent,
                content: row.content,
                createdAt: row.created_at,
            }));
        }
        return this.memory.get(sessionId) ?? [];
    }
};
exports.HistoryService = HistoryService;
exports.HistoryService = HistoryService = __decorate([
    (0, common_1.Injectable)()
], HistoryService);
//# sourceMappingURL=history.service.js.map