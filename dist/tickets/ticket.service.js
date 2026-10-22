"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketService = void 0;
const common_1 = require("@nestjs/common");
const postgres_1 = require("../config/postgres");
/**
 * A ticket is created when a conversation needs to outlive the chat itself -
 * low router confidence, an explicit "talk to a human", or a refund request.
 *
 * Phase 2 material: a real queue, assignment and notifications. For now the
 * ticket is a row and the escalation is a message.
 */
let TicketService = class TicketService {
    memory = [];
    nextId = 1;
    get mode() {
        return (0, postgres_1.db)() ? 'postgres' : 'memory';
    }
    async create(params) {
        const status = params.status ?? 'open';
        const pool = (0, postgres_1.db)();
        if (pool) {
            const result = await pool.query(`INSERT INTO tickets (session_id, intent, status, summary)
         VALUES ($1, $2, $3, $4)
         RETURNING id, session_id, intent, status, summary, created_at`, [params.sessionId, params.intent, status, params.summary]);
            const row = result.rows[0];
            return {
                id: row.id,
                sessionId: row.session_id,
                intent: row.intent,
                status: row.status,
                summary: row.summary,
                createdAt: row.created_at,
            };
        }
        const ticket = {
            id: this.nextId++,
            sessionId: params.sessionId,
            intent: params.intent,
            status,
            summary: params.summary,
            createdAt: new Date(),
        };
        this.memory.push(ticket);
        return ticket;
    }
    async markEscalated(sessionId, summary) {
        return this.create({ sessionId, intent: 'handoff', summary, status: 'escalated' });
    }
    async close(sessionId) {
        await (0, postgres_1.db)()?.query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE session_id = $1`, [sessionId]);
    }
    async listBySession(sessionId) {
        const pool = (0, postgres_1.db)();
        if (pool) {
            const result = await pool.query(`SELECT id, session_id, intent, status, summary, created_at
         FROM tickets WHERE session_id = $1 ORDER BY id DESC`, [sessionId]);
            return result.rows.map((row) => ({
                id: row.id,
                sessionId: row.session_id,
                intent: row.intent,
                status: row.status,
                summary: row.summary,
                createdAt: row.created_at,
            }));
        }
        return this.memory.filter((ticket) => ticket.sessionId === sessionId);
    }
};
exports.TicketService = TicketService;
exports.TicketService = TicketService = __decorate([
    (0, common_1.Injectable)()
], TicketService);
//# sourceMappingURL=ticket.service.js.map