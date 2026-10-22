"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const logger_1 = require("../common/logger");
const session_service_1 = require("../sessions/session.service");
const history_service_1 = require("../history/history.service");
const graph_service_1 = require("../agents/graph.service");
const rag_service_1 = require("../knowledge/rag.service");
const llm_service_1 = require("../llm/llm.service");
const vector_service_1 = require("../knowledge/vector.service");
const MAX_MESSAGE_CHARS = 2000;
/**
 * WebSocket Gateway - the live pipe between browser and server.
 *
 * Events:
 *   client -> server   chat:send { content, sessionId? }
 *                      chat:reset { sessionId }
 *                      chat:history { sessionId }
 *   server -> client   session { sessionId }
 *                      agent:typing { typing: boolean }
 *                      chat:reply  ChatReplyPayload
 *                      chat:history { messages }
 *                      error { message }
 */
let ChatGateway = class ChatGateway {
    sessions;
    history;
    graph;
    rag;
    llm;
    vectors;
    server;
    constructor(sessions, history, graph, rag, llm, vectors) {
        this.sessions = sessions;
        this.history = history;
        this.graph = graph;
        this.rag = rag;
        this.llm = llm;
        this.vectors = vectors;
    }
    handleConnection(client) {
        logger_1.logger.info(`socket connected: ${client.id}`);
        client.emit('session', {
            sessionId: client.id,
            modes: {
                llm: this.llm.mode,
                vector: this.vectors.mode,
                session: this.sessions.mode,
                history: this.history.mode,
            },
        });
    }
    handleDisconnect(client) {
        logger_1.logger.info(`socket disconnected: ${client.id}`);
    }
    /** The whole point of the app: one message in, one grounded answer out. */
    async onChat(client, payload) {
        const content = (payload?.content ?? '').trim();
        if (!content) {
            client.emit('error', { message: 'Empty message' });
            return;
        }
        if (content.length > MAX_MESSAGE_CHARS) {
            client.emit('error', { message: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` });
            return;
        }
        // A socket without a stored session id defaults to its own socket id, so
        // a fresh visitor gets a conversation without any handshake.
        const session = await this.sessions.getOrCreate(payload.sessionId ?? client.id);
        const sessionId = session.sessionId;
        client.emit('session', { sessionId });
        client.emit('agent:typing', { typing: true });
        try {
            const history = await this.history.getHistory(sessionId);
            const result = await this.graph.handle({
                sessionId,
                userMessage: content,
                history: history.map((message) => ({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: message.content,
                })),
            });
            // Both sides of the conversation are permanent, in PostgreSQL if configured.
            await this.history.append({
                sessionId,
                role: 'user',
                agent: null,
                content,
                createdAt: new Date(),
            });
            await this.history.append({
                sessionId,
                role: 'assistant',
                agent: result.agent,
                content: result.answer,
                createdAt: new Date(),
            });
            // Session state is short-lived: which agent owns the chat, and how
            // many messages have passed. It expires on its own.
            await this.sessions.update(sessionId, {
                currentAgent: result.agent,
                lastIntent: result.intent,
                messageCount: 2,
            });
            const reply = {
                sessionId,
                content: result.answer,
                agent: result.agent,
                intent: result.intent,
                confidence: result.confidence,
                reason: result.routeReason,
                sources: result.sources.map((source) => ({
                    source: source.source,
                    title: source.title,
                    score: Number(source.score.toFixed(3)),
                })),
                needsHuman: result.needsHuman,
                ticketId: result.ticketId,
            };
            client.emit('chat:reply', reply);
        }
        catch (err) {
            logger_1.logger.error(`chat:send failed - ${err.message}`);
            client.emit('error', {
                message: 'Something went wrong while handling your message. Please try again.',
            });
        }
        finally {
            client.emit('agent:typing', { typing: false });
        }
    }
    async onReset(client, payload) {
        const sessionId = payload?.sessionId ?? client.id;
        await this.sessions.destroy(sessionId);
        client.emit('chat:reset', { sessionId });
    }
    async onHistory(client, payload) {
        const sessionId = payload?.sessionId ?? client.id;
        client.emit('chat:history', { messages: await this.history.getAll(sessionId) });
    }
    /** Re-chunks and re-embeds the markdown files in knowledge/. */
    async onReindex(client) {
        const count = await this.rag.ingest();
        client.emit('knowledge:reindex', { chunks: count });
    }
};
exports.ChatGateway = ChatGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", Function)
], ChatGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('chat:send'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "onChat", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('chat:reset'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "onReset", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('chat:history'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "onHistory", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('knowledge:reindex'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "onReindex", null);
exports.ChatGateway = ChatGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({ cors: { origin: '*' } }),
    __metadata("design:paramtypes", [session_service_1.SessionService,
        history_service_1.HistoryService,
        graph_service_1.GraphService,
        rag_service_1.RagService,
        llm_service_1.LlmService,
        vector_service_1.VectorService])
], ChatGateway);
//# sourceMappingURL=chat.gateway.js.map