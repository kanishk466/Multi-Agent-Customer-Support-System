import { Injectable } from '@nestjs/common';
import { db } from '../config/postgres';

export type TicketStatus = 'open' | 'escalated' | 'closed';

export interface Ticket {
  id: number;
  sessionId: string;
  intent: string;
  status: TicketStatus;
  summary: string | null;
  createdAt: Date;
}

/**
 * A ticket is created when a conversation needs to outlive the chat itself -
 * low router confidence, an explicit "talk to a human", or a refund request.
 *
 * Phase 2 material: a real queue, assignment and notifications. For now the
 * ticket is a row and the escalation is a message.
 */
@Injectable()
export class TicketService {
  private memory: Ticket[] = [];
  private nextId = 1;

  get mode(): 'postgres' | 'memory' {
    return db() ? 'postgres' : 'memory';
  }

  async create(params: {
    sessionId: string;
    intent: string;
    summary: string;
    status?: TicketStatus;
  }): Promise<Ticket> {
    const status = params.status ?? 'open';
    const pool = db();

    if (pool) {
      const result = await pool.query(
        `INSERT INTO tickets (session_id, intent, status, summary)
         VALUES ($1, $2, $3, $4)
         RETURNING id, session_id, intent, status, summary, created_at`,
        [params.sessionId, params.intent, status, params.summary],
      );
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

    const ticket: Ticket = {
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

  async markEscalated(sessionId: string, summary: string): Promise<Ticket> {
    return this.create({ sessionId, intent: 'handoff', summary, status: 'escalated' });
  }

  async close(sessionId: string): Promise<void> {
    await db()?.query(
      `UPDATE tickets SET status = 'closed', updated_at = now() WHERE session_id = $1`,
      [sessionId],
    );
  }

  async listBySession(sessionId: string): Promise<Ticket[]> {
    const pool = db();
    if (pool) {
      const result = await pool.query(
        `SELECT id, session_id, intent, status, summary, created_at
         FROM tickets WHERE session_id = $1 ORDER BY id DESC`,
        [sessionId],
      );
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
}
