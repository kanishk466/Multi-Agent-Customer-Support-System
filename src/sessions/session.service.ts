import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../common/logger';
import { redis } from '../config/redis';

export interface SessionState {
  sessionId: string;
  currentAgent: string | null;
  lastIntent: string | null;
  messageCount: number;
  updatedAt: number;
}

const KEY = (sessionId: string) => `support:session:${sessionId}`;

/**
 * Redis = "abhi kya chal raha hai". Short-lived conversation state: which
 * specialist agent owns this chat, what the last intent was, a message count.
 *
 * Everything expires after SESSION_TTL_SECONDS, so Redis never becomes a
 * second permanent database. History lives in PostgreSQL.
 */
@Injectable()
export class SessionService {
  /** In-memory fallback used when Redis is not connected. */
  private memory = new Map<string, { value: SessionState; expiresAt: number }>();

  get mode(): 'redis' | 'memory' {
    return redis() ? 'redis' : 'memory';
  }

  async getOrCreate(sessionId?: string): Promise<SessionState> {
    const id = sessionId ?? randomUUID();
    const existing = await this.get(id);
    if (existing) return existing;

    const state: SessionState = {
      sessionId: id,
      currentAgent: null,
      lastIntent: null,
      messageCount: 0,
      updatedAt: Date.now(),
    };
    await this.save(state);
    return state;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    const client = redis();

    if (client) {
      const raw = await client.get(KEY(sessionId));
      return raw ? (JSON.parse(raw) as SessionState) : null;
    }

    const entry = this.memory.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.memory.delete(sessionId);
      return null;
    }
    return entry.value;
  }

  /** Patches and persists session state, refreshing the TTL. */
  async update(sessionId: string, patch: Partial<Omit<SessionState, 'sessionId'>>): Promise<SessionState> {
    const state = (await this.get(sessionId)) ?? (await this.getOrCreate(sessionId));
    const next: SessionState = {
      ...state,
      ...patch,
      messageCount: state.messageCount + (patch.messageCount ?? 0),
      updatedAt: Date.now(),
    };
    await this.save(next);
    return next;
  }

  async destroy(sessionId: string): Promise<void> {
    await redis()?.del(KEY(sessionId));
    this.memory.delete(sessionId);
    logger.debug(`Session destroyed: ${sessionId}`);
  }

  private async save(state: SessionState): Promise<void> {
    const client = redis();
    if (client) {
      await client.set(KEY(state.sessionId), JSON.stringify(state), 'EX', env.SESSION_TTL_SECONDS);
      return;
    }
    this.memory.set(state.sessionId, {
      value: state,
      expiresAt: Date.now() + env.SESSION_TTL_SECONDS * 1000,
    });
  }
}
