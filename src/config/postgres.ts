import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../common/logger';

/**
 * PostgreSQL = "kya hua tha" (permanent, disk). Chat history + tickets.
 *
 * Optional: without DATABASE_URL the server keeps both in memory so the
 * demo still runs.
 */
let pool: Pool | null = null;
let available = false;

/** Idempotent schema - safe to run on every boot. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  agent       TEXT,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id);

CREATE TABLE IF NOT EXISTS tickets (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT        NOT NULL,
  intent      TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'escalated', 'closed')),
  summary     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_session ON tickets (session_id);
`;

export async function initDatabase(): Promise<Pool | null> {
  if (!env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set - persistence: in-memory');
    return null;
  }

  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });

  try {
    await pool.query('SELECT 1');
    await pool.query(SCHEMA);
    available = true;
    logger.info('PostgreSQL connected + schema ensured');
    return pool;
  } catch (err) {
    logger.warn(`PostgreSQL unavailable (${(err as Error).message}) - persistence: in-memory`);
    pool = null;
    available = false;
    return null;
  }
}

export function db(): Pool | null {
  return available && pool ? pool : null;
}

export function dbAvailable(): boolean {
  return db() !== null;
}
