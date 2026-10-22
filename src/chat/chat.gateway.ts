import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { logger } from '../common/logger';
import { SessionService } from '../sessions/session.service';
import { HistoryService } from '../history/history.service';
import { GraphService } from '../agents/graph.service';
import { RagService } from '../knowledge/rag.service';
import { LlmService } from '../llm/llm.service';
import { VectorService } from '../knowledge/vector.service';

const MAX_MESSAGE_CHARS = 2000;

export interface ChatSendPayload {
  sessionId?: string;
  content: string;
}

export interface SourceSummary {
  source: string;
  title: string;
  score: number;
}

export interface ChatReplyPayload {
  sessionId: string;
  content: string;
  agent: string | null;
  intent: string;
  confidence: number;
  reason: string;
  sources: SourceSummary[];
  needsHuman: boolean;
  ticketId: number | null;
}

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
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly history: HistoryService,
    private readonly graph: GraphService,
    private readonly rag: RagService,
    private readonly llm: LlmService,
    private readonly vectors: VectorService,
  ) {}

  handleConnection(client: Socket): void {
    logger.info(`socket connected: ${client.id}`);
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

  handleDisconnect(client: Socket): void {
    logger.info(`socket disconnected: ${client.id}`);
  }

  /** The whole point of the app: one message in, one grounded answer out. */
  @SubscribeMessage('chat:send')
  async onChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatSendPayload,
  ): Promise<void> {
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
          role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
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

      const reply: ChatReplyPayload = {
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
    } catch (err) {
      logger.error(`chat:send failed - ${(err as Error).message}`);
      client.emit('error', {
        message: 'Something went wrong while handling your message. Please try again.',
      });
    } finally {
      client.emit('agent:typing', { typing: false });
    }
  }

  @SubscribeMessage('chat:reset')
  async onReset(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): Promise<void> {
    const sessionId = payload?.sessionId ?? client.id;
    await this.sessions.destroy(sessionId);
    client.emit('chat:reset', { sessionId });
  }

  @SubscribeMessage('chat:history')
  async onHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): Promise<void> {
    const sessionId = payload?.sessionId ?? client.id;
    client.emit('chat:history', { messages: await this.history.getAll(sessionId) });
  }

  /** Re-chunks and re-embeds the markdown files in knowledge/. */
  @SubscribeMessage('knowledge:reindex')
  async onReindex(@ConnectedSocket() client: Socket): Promise<void> {
    const count = await this.rag.ingest();
    client.emit('knowledge:reindex', { chunks: count });
  }
}
