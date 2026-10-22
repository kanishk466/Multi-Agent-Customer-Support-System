import 'dotenv/config';
import { z } from 'zod';

/** Optional string that treats "" / whitespace as "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  /* LLM providers (both have generous free tiers) */
  GROQ_API_KEY: optionalString,
  /**
   * Groq retires models without much notice - llama-3.3-70b-versatile and
   * friends are gone. Verify yours with `npm run doctor` against
   * https://api.groq.com/openai/v1/models
   */
  GROQ_MODEL: z.string().default('qwen/qwen3.8-27b'),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),

  /* Embeddings for RAG */
  EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  /** Gemini supports 1-3072; 768 keeps the local Qdrant collection light. */
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(768),

  /* Vector store */
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_API_KEY: optionalString,
  QDRANT_COLLECTION: z.string().default('support_knowledge'),

  /* Storage - both optional, degrade to in-memory */
  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,

  /* Behaviour tuning */
  /** Router below this confidence escalates to a human instead of answering. */
  HANDOFF_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  RAG_TOP_K: z.coerce.number().int().positive().default(4),
  RAG_MIN_SCORE: z.coerce.number().default(0.35),
  /** Local hash embeddings score far lower than real ones - see rag.service. */
  RAG_MIN_SCORE_LOCAL: z.coerce.number().default(0.08),
  CHUNK_MAX_CHARS: z.coerce.number().int().positive().default(600),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().min(0).default(80),
  KNOWLEDGE_DIR: z.string().default('knowledge'),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(10),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

const parsed = schema.parse(process.env);

const hasGroq = Boolean(parsed.GROQ_API_KEY);
const hasGemini = Boolean(parsed.GEMINI_API_KEY);
const hasAnyLlm = hasGroq || hasGemini;

if (!hasAnyLlm) {
  process.emitWarning(
    'No LLM API key found - running in offline demo mode. ' +
      'Set GROQ_API_KEY or GEMINI_API_KEY for real answers.',
  );
}

export const env = {
  ...parsed,
  hasGroq,
  hasGemini,
  hasAnyLlm,
  /** Cloud LLM enabled? */
  useLlm: hasAnyLlm,
  /** Cloud embeddings enabled? Gemini is the only free embedding option here. */
  useCloudEmbeddings: hasGemini,
};

export type Env = typeof env;
