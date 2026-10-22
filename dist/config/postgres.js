"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.db = db;
exports.dbAvailable = dbAvailable;
const pg_1 = require("pg");
const env_1 = require("./env");
const logger_1 = require("../common/logger");
/**
 * PostgreSQL = "kya hua tha" (permanent, disk). Chat history + tickets.
 *
 * Optional: without DATABASE_URL the server keeps both in memory so the
 * demo still runs.
 */
let pool = null;
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
async function initDatabase() {
    if (!env_1.env.DATABASE_URL) {
        logger_1.logger.warn('DATABASE_URL not set - persistence: in-memory');
        return null;
    }
    pool = new pg_1.Pool({ connectionString: env_1.env.DATABASE_URL, max: 5 });
    try {
        await pool.query('SELECT 1');
        await pool.query(SCHEMA);
        available = true;
        logger_1.logger.info('PostgreSQL connected + schema ensured');
        return pool;
    }
    catch (err) {
        logger_1.logger.warn(`PostgreSQL unavailable (${err.message}) - persistence: in-memory`);
        pool = null;
        available = false;
        return null;
    }
}
function db() {
    return available && pool ? pool : null;
}
function dbAvailable() {
    return db() !== null;
}
//# sourceMappingURL=postgres.js.map