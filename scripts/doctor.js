/**
 * Environment doctor - checks every external dependency one by one.
 *
 *   npm run doctor
 *
 * Prints PASS/FAIL per service plus an actionable hint on failure, and
 * never prints a credential. Run this before debugging "why is my reply
 * offline / why are there no sources".
 */
require('dotenv').config();

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

const results = [];

function record(service, status, detail, hint) {
  results.push({ service, status, detail, hint });
}

function mask(value) {
  if (!value) return '<empty>';
  return `${value.slice(0, 4)}...${value.slice(-3)} (len ${value.length})`;
}

function maskUrl(value) {
  if (!value) return '<empty>';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return value.replace(/:[^:@/]+@/, ':***@');
  }
}

async function withTimeout(name, ms, fn) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)),
    ]);
    return { ok: true, ms: Date.now() - started, value };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err };
  }
}

/* ─────────────────────────── Checks ─────────────────────────── */

async function checkEnv() {
  const required = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'QDRANT_URL', 'QDRANT_API_KEY', 'DATABASE_URL', 'REDIS_URL'];
  const missing = required.filter((key) => !process.env[key]);

  record(
    '.env',
    missing.length === 0 ? PASS : missing.length === required.length ? FAIL : 'WARN',
    missing.length === 0
      ? required.map((key) => `${key}=${mask(process.env[key])}`).join('  ')
      : `missing: ${missing.join(', ')}`,
    missing.length ? 'Copy values from .env.example, then restart.' : '',
  );
}

async function checkGroq() {
  if (!process.env.GROQ_API_KEY) return record('Groq LLM', SKIP, 'GROQ_API_KEY empty', 'Add a key from console.groq.com/keys');

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const res = await withTimeout('groq', 20000, () =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
    }).then(async (r) => ({ status: r.status, body: await r.text() })),
  );

  if (!res.ok) {
    return record('Groq LLM', FAIL, `${res.error.message}`, 'Is the key valid? Is this machine online?');
  }
  if (res.value.status !== 200) {
    return record('Groq LLM', FAIL, `HTTP ${res.value.status}: ${res.value.body.slice(0, 200)}`,
      res.value.status === 401 ? 'Key invalid or revoked.' : 'Model name wrong in GROQ_MODEL?');
  }

  const json = JSON.parse(res.value.body);
  const text = json.choices?.[0]?.message?.content ?? '';
  record('Groq LLM', PASS, `${model} -> "${text.trim().slice(0, 30)}" (${res.ms}ms)`, '');
}

async function checkGeminiChat() {
  if (!process.env.GEMINI_API_KEY) return record('Gemini LLM', SKIP, 'GEMINI_API_KEY empty', 'Add a key from aistudio.google.com/apikey');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await withTimeout('gemini-chat', 20000, () =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        // Too small a budget and Gemini 3.x spends it all on thinking and
        // answers with an empty string - a misleading PASS.
        generationConfig: { maxOutputTokens: 512 },
      }),
    }).then(async (r) => ({ status: r.status, body: await r.text() })),
  );

  if (!res.ok) return record('Gemini LLM', FAIL, res.error.message, 'Is the key valid? Is this machine online?');
  if (res.value.status !== 200) {
    return record('Gemini LLM', FAIL, `HTTP ${res.value.status}: ${res.value.body.slice(0, 200)}`, 'GEMINI_MODEL wrong?');
  }
  const json = JSON.parse(res.value.body);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) {
    const reason = json.candidates?.finishReason ?? 'no text';
    return record('Gemini LLM', 'WARN',
      `${model} reachable but returned empty (finishReason=${reason}) (${res.ms}ms)`,
      'Gemini 3.x thinks before answering - raise maxOutputTokens, or rely on Groq as primary.');
  }
  record('Gemini LLM', PASS, `${model} -> "${text.trim().slice(0, 30)}" (${res.ms}ms)`, '');
}

async function checkEmbeddings() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  if (!hasGemini) {
    return record('Embeddings', SKIP, 'no GEMINI_API_KEY -> local hash embeddings', 'Real RAG quality needs a Gemini key.');
  }

  const model = process.env.EMBEDDING_MODEL || 'gemini-embedding-004';
  const dims = Number(process.env.EMBEDDING_DIMS || 768);

  const res = await withTimeout('embeddings', 30000, () =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: 'refund policy test' }] },
        outputDimensionality: dims,
      }),
    }).then(async (r) => ({ status: r.status, body: await r.text() })),
  );

  if (!res.ok) return record('Embeddings', FAIL, res.error.message, 'Is this machine online?');
  if (res.value.status !== 200) {
    return record('Embeddings', FAIL, `HTTP ${res.value.status}: ${res.value.body.slice(0, 200)}`,
      'Model not available on this key, or EMBEDDING_DIMS rejected.');
  }

  const json = JSON.parse(res.value.body);
  const values = json.embedding?.values ?? [];
  record(
    'Embeddings',
    values.length === dims ? PASS : FAIL,
    `${model} -> ${values.length} dims (expected ${dims}) (${res.ms}ms)`,
    values.length === dims ? '' : 'Collection dims would not match. Fix EMBEDDING_DIMS and re-run: npm run seed',
  );
}

async function checkQdrant() {
  const url = (process.env.QDRANT_URL || '').replace(/\/$/, '');
  if (!url) return record('Qdrant', SKIP, 'QDRANT_URL empty -> in-memory vector store', '');

  const collection = process.env.QDRANT_COLLECTION || 'support_knowledge';
  const dims = Number(process.env.EMBEDDING_DIMS || 768);
  const headers = {
    // Qdrant Cloud answers 403 to `apikey`; the header is `api-key`.
    'api-key': process.env.QDRANT_API_KEY || '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const call = async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  };

  const reachable = await withTimeout('qdrant', 25000, () => call('GET', '/collections'));
  if (!reachable.ok) {
    return record('Qdrant', FAIL, reachable.error.message, `Cannot reach ${maskUrl(url)}. Online? URL correct?`);
  }
  if (reachable.value.status !== 200) {
    return record('Qdrant', FAIL, `HTTP ${reachable.value.status}: ${reachable.value.text.slice(0, 200)}`,
      'Check QDRANT_URL / QDRANT_API_KEY. Qdrant Cloud rejects the wrong header with 403.');
  }

  // The app cannot work without this collection, so the doctor creates it
  // rather than just reporting that it is missing.
  // The REST payload nests the list under `result`; the JS client unwraps it.
  const collections = reachable.value.json?.result?.collections ?? [];
  const exists = collections.some((c) => c.name === collection);
  if (!exists) {
    const created = await call('PUT', `/collections/${encodeURIComponent(collection)}`, {
      vectors: { size: dims, distance: 'Cosine' },
    });
    if (created.status !== 200) {
      return record('Qdrant', FAIL, `createCollection HTTP ${created.status}: ${created.text.slice(0, 200)}`, '');
    }
  }

  // Payload indexes: the app filters on both of these, and Qdrant rejects
  // any filter over an unindexed key with "Index required but not found".
  for (const field of ['documentId', 'category']) {
    const indexed = await call('PUT', `/collections/${encodeURIComponent(collection)}/index?wait=true`, {
      field_name: field,
      field_schema: 'keyword',
    });
    if (indexed.status !== 200 && !/exist|409/i.test(indexed.text)) {
      return record('Qdrant', FAIL, `index(${field}) HTTP ${indexed.status}: ${indexed.text.slice(0, 200)}`, '');
    }
  }

  // Full write round-trip with the exact shapes the app uses. This is what
  // catches invalid point ids and missing indexes - a read-only check never
  // sees either.
  const probeId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const probeVector = Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0));
  const probePayload = {
    chunkId: '__doctor_probe__',
    documentId: '__doctor_probe__',
    source: 'doctor',
    title: 'doctor',
    category: 'general',
    chunkIndex: 0,
    text: 'doctor probe',
  };

  const upsert = await withTimeout('qdrant-upsert', 25000, () =>
    call('PUT', `/collections/${encodeURIComponent(collection)}/points?wait=true`, {
      points: [{ id: probeId, vector: probeVector, payload: probePayload }],
    }),
  );
  if (!upsert.ok || upsert.value.status !== 200) {
    return record('Qdrant', FAIL,
      `upsert ${upsert.value?.status ?? 'ERR'}: ${(upsert.value?.text ?? upsert.error.message).slice(0, 220)}`,
      'Qdrant point ids must be an unsigned integer or a UUID - strings are rejected.');
  }

  const query = await withTimeout('qdrant-query', 25000, () =>
    call('POST', `/collections/${encodeURIComponent(collection)}/points/query`, {
      query: { nearest: probeVector },
      limit: 3,
      with_payload: true,
      filter: { must: [{ key: 'category', match: { value: 'general' } }] },
    }),
  );
  if (!query.ok || query.value.status !== 200) {
    return record('Qdrant', FAIL,
      `query ${query.value?.status ?? 'ERR'}: ${(query.value?.text ?? query.error.message).slice(0, 220)}`,
      'Filtered query failed - the payload index on `category` is probably missing.');
  }

  const cleanup = await call('POST', `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`, {
    filter: { must: [{ key: 'documentId', match: { value: '__doctor_probe__' } }] },
  });
  if (cleanup.status !== 200) {
    return record('Qdrant', FAIL,
      `delete ${cleanup.status}: ${cleanup.text.slice(0, 220)}`,
      'Filtered delete failed - the payload index on `documentId` is probably missing.');
  }

  const counted = await withTimeout('qdrant-count', 25000, () =>
    call('POST', `/collections/${encodeURIComponent(collection)}/points/count`, { exact: true }),
  );
  const points = counted.ok ? counted.value.json?.result?.count : null;
  record('Qdrant', PASS,
    `${maskUrl(url)} "${collection}" = ${points ?? '?'} points; upsert/query/delete OK`,
    points === 0 ? 'Vector store is empty - run: npm run seed' : '');
}

async function checkPostgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return record('PostgreSQL', SKIP, 'DATABASE_URL empty -> in-memory history', '');

  let pg;
  try {
    pg = require('pg');
  } catch {
    return record('PostgreSQL', FAIL, 'pg package not installed', 'npm install');
  }

  const res = await withTimeout('postgres', 20000, async () => {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
    await client.connect();
    const out = await client.query('SELECT version(), current_database()');
    await client.end();
    return out.rows[0];
  });

  if (!res.ok) {
    const message = res.error.message || String(res.error);
    return record('PostgreSQL', FAIL, message,
      /certificate|SSL/i.test(message)
        ? 'TLS failure. Remove &channel_binding=require from DATABASE_URL, or add &sslmode=require only.'
        : 'Check DATABASE_URL, or that Neon/your DB allows this IP.');
  }

  const db = res.value.current_database;

  // Confirm the app's schema exists and has actually been written to.
  const rows = await withTimeout('postgres-rows', 15000, async () => {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
    await client.connect();
    try {
      const out = await client.query(
        `SELECT (SELECT count(*) FROM messages) AS messages,
                (SELECT count(*) FROM tickets)  AS tickets`,
      );
      return out.rows[0];
    } finally {
      await client.end();
    }
  });

  if (!rows.ok) {
    const missingTable = /does not exist/i.test(rows.error.message || '');
    return record('PostgreSQL', missingTable ? 'WARN' : FAIL,
      missingTable ? `connected to "${db}", but messages/tickets tables not created yet` : rows.error.message,
      missingTable ? 'Start the server once (npm run dev) - main.ts runs the schema on boot.' : '');
  }

  record('PostgreSQL', PASS,
    `connected to "${db}" (${res.ms}ms); messages=${rows.value.messages} tickets=${rows.value.tickets}`,
    Number(rows.value.messages) === 0 ? 'No messages yet - run: npm run smoke' : '');
}

async function checkRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return record('Redis', SKIP, 'REDIS_URL empty -> in-memory sessions', '');

  let Redis;
  try {
    Redis = require('ioredis');
  } catch {
    return record('Redis', FAIL, 'ioredis package not installed', 'npm install');
  }

  const res = await withTimeout('redis', 20000, async () => {
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 15000 });
    try {
      await client.connect();
      return await client.ping();
    } finally {
      client.disconnect();
    }
  });

  if (!res.ok) {
    const message = res.error.message || String(res.error);
    return record('Redis', FAIL, message,
      /TLS|SSL|certificate/i.test(message)
        ? 'TLS failure. Upstash requires rediss:// and no plain redis://.'
        : 'Check REDIS_URL, or that Upstash allows this connection.');
  }

  record('Redis', PASS, `PING -> ${res.value} (${res.ms}ms)`, '');
}

/* ─────────────────────────── Runner ─────────────────────────── */

async function main() {
  await checkEnv();
  await checkGroq();
  await checkGeminiChat();
  await checkEmbeddings();
  await checkQdrant();
  await checkPostgres();
  await checkRedis();

  console.log('');
  for (const r of results) {
    const icon = r.status === PASS ? '\x1b[32m[PASS]\x1b[0m' : r.status === FAIL ? '\x1b[31m[FAIL]\x1b[0m' : r.status === 'WARN' ? '\x1b[33m[WARN]\x1b[0m' : '\x1b[90m[SKIP]\x1b[0m';
    console.log(`${icon} ${r.service.padEnd(14)} ${r.detail}`);
    if (r.hint && r.status !== PASS) console.log(`        -> ${r.hint}`);
  }

  const failed = results.filter((r) => r.status === FAIL);
  const skipped = results.filter((r) => r.status === SKIP);
  console.log('');
  console.log(`${failed.length} failed, ${skipped.length} skipped, ${results.length} total.`);
  if (failed.some((r) => r.service === 'Groq LLM') && skipped.some((r) => r.service === 'Gemini LLM')) {
    console.log('No working LLM -> the server will run in offline demo mode (keyword router, no written answers).');
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`Doctor crashed: ${err.stack || err}`);
  process.exit(1);
});
