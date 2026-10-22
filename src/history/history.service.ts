import { Injectable } from '@nestjs/common';
import { db } from '../config/postgres';
import { env } from '../config/env';
import type { LlmMessage, LlmRole } from '../llm/llm.types';

export interface StoredMessage {
  sessionId: string;
  role: LlmRole;
  agent: string | null;
  content: string;
  createdAt: Date;
}

/**
 * PostgreSQL = "kya hua tha". Permanent chat history, kept far beyond the
 * Redis session TTL so a conversation can be resumed or audited later.
 *
 * In-memory fallback when DATABASE_URL is unset.
 */
@Injectable()
export class HistoryService {
  private memory = new Map<string, StoredMessage[]>();

  get mode(): 'postgres' | 'memory' {
    return db() ? 'postgres' : 'memory';
  }

  async append(message: StoredMessage): Promise<void> {
    const pool = db();

    if (pool) {
      await pool.query(
        `INSERT INTO messages (session_id, role, agent, content) VALUES ($1, $2, $3, $4)`,
        [message.sessionId, message.role, message.agent, message.content],
      );
      return;
    }

    const list = this.memory.get(message.sessionId) ?? [];
    list.push(message);
    // Keep the in-memory fallback bounded.
    this.memory.set(message.sessionId, list.slice(-200));
  }

  /** Most recent messages, oldest first - ready to drop straight into an LLM call. */
  async getHistory(sessionId: string, limit = env.MAX_HISTORY_MESSAGES): Promise<LlmMessage[]> {
    const pool = db();

    if (pool) {
      const result = await pool.query(
        `SELECT role, content FROM messages
         WHERE session_id = $1 AND role <> 'system'
         ORDER BY id DESC LIMIT $2`,
        [sessionId, limit],
      );
      return result.rows
        .slice()
        .reverse()
        .map((row) => ({ role: row.role as LlmRole, content: row.content }));
    }

    return (this.memory.get(sessionId) ?? [])
      .slice(-limit)
      .map((message) => ({ role: message.role, content: message.content }));
  }

  async getAll(sessionId: string): Promise<StoredMessage[]> {
    const pool = db();

    if (pool) {
      const result = await pool.query(
        `SELECT role, agent, content, created_at FROM messages
         WHERE session_id = $1 ORDER BY id ASC`,
        [sessionId],
      );
      return result.rows.map((row) => ({
        sessionId,
        role: row.role as LlmRole,
        agent: row.agent,
        content: row.content,
        createdAt: row.created_at,
      }));
    }

    return this.memory.get(sessionId) ?? [];
  }
}
