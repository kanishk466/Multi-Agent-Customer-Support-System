import { Injectable, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { env } from '../config/env';
import { logger } from '../common/logger';
import { LlmService } from '../llm/llm.service';
import type { LlmMessage } from '../llm/llm.types';
import { EmbeddingsService } from './embeddings.service';
import { VectorService, type ChunkMetadata } from './vector.service';

export interface RetrievedContext {
  score: number;
  source: string;
  title: string;
  category: string;
  text: string;
}

export interface RagAnswer {
  answer: string;
  sources: RetrievedContext[];
  usedContext: boolean;
}

/** Maps a filename to the agent category that should own it. */
function categoryFromFilename(filename: string): string {
  const name = filename.toLowerCase();
  if (name.includes('billing') || name.includes('refund')) return 'billing';
  if (name.includes('tech') || name.includes('troubleshoot')) return 'tech';
  if (name.includes('sales') || name.includes('pricing')) return 'sales';
  return 'general';
}

/**
 * RAG = "company docs se answer dhundhna".
 *
 * ingest():  docs -> sections -> chunks -> embeddings -> vector store
 * answer():  query -> embedding -> similarity search -> context -> LLM
 */
@Injectable()
export class RagService implements OnModuleInit {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: VectorService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Ingests on boot, but only when the store is empty.
   *
   * Re-embedding 19 chunks on every restart costs ~10s and burns free-tier
   * quota for no benefit. Once populated, `npm run seed` (or the
   * `knowledge:reindex` socket event) is how you pick up edited docs - the
   * log line below says so out loud rather than leaving you guessing why a
   * new file did not show up.
   */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.vectors.count();
      if (existing > 0) {
        logger.info(
          `Knowledge base ready: ${existing} chunks (${this.vectors.mode} store). ` +
            `Skipping ingest - run "npm run seed" after editing ${env.KNOWLEDGE_DIR}/`,
        );
        return;
      }

      const count = await this.ingest();
      logger.info(`Knowledge base ready: ${count} chunks (${this.vectors.mode} store)`);
    } catch (err) {
      // QdrantClient puts the useful message in `data`, not `message` -
      // without it a failed ingest is just "Bad Request".
      const detail = (err as { data?: unknown }).data ?? (err as Error).message;
      logger.warn(`Knowledge ingest failed: ${JSON.stringify(detail)}`);
    }
  }

  /** Reads every markdown file in KNOWLEDGE_DIR and stores its chunks. */
  async ingest(): Promise<number> {
    const files = (await fs.readdir(env.KNOWLEDGE_DIR)).filter((file) => file.endsWith('.md'));
    if (files.length === 0) {
      logger.warn(`No .md files in ${env.KNOWLEDGE_DIR} - RAG has nothing to search`);
      return 0;
    }

    let total = 0;
    for (const file of files) {
      const documentId = basename(file, '.md');
      const category = categoryFromFilename(file);
      const content = await fs.readFile(join(env.KNOWLEDGE_DIR, file), 'utf8');
      const chunks = this.toChunks(content, documentId, file, category);
      if (chunks.length === 0) continue;

      // Re-ingesting a doc must not leave stale duplicates behind.
      await this.vectors.deleteByDocument(documentId);

      const vectors = await this.embeddings.embed(chunks.map((chunk) => chunk.text));
      await this.vectors.upsert(
        chunks.map((chunk, index) => ({
          id: chunk.chunkId,
          values: vectors[index],
          metadata: chunk,
        })),
      );
      total += chunks.length;
    }

    logger.info(`Ingested ${files.length} docs -> ${total} chunks`);
    return total;
  }

  /**
   * Splits markdown into chunks. Sections (## headings) are preferred because
   * they keep a policy statement intact; long sections fall back to a
   * sliding window with overlap so no sentence is cut in half.
   */
  private toChunks(content: string, documentId: string, source: string, category: string): ChunkMetadata[] {
    const title = content.match(/^#\s+(.+)$/m)?.[1] ?? documentId;
    const sections = content.split(/^##\s+/m).slice(1);

    const chunks: ChunkMetadata[] = [];
    for (const [sectionIndex, section] of sections.entries()) {
      const sectionTitle = section.split('\n')[0].trim();
      for (const [pieceIndex, text] of chunkText(
        section,
        env.CHUNK_MAX_CHARS,
        env.CHUNK_OVERLAP_CHARS,
      ).entries()) {
        const clean = text.trim();
        if (clean.length < 40) continue;
        chunks.push({
          chunkId: `${documentId}-${sectionIndex}-${pieceIndex}`,
          documentId,
          source,
          title,
          category,
          chunkIndex: chunks.length,
          text: `# ${title} > ${sectionTitle}\n${clean}`,
        });
      }
    }
    return chunks;
  }

  /** Similarity search. `category` narrows results to one specialist agent. */
  async retrieve(query: string, category?: string, topK = env.RAG_TOP_K): Promise<RetrievedContext[]> {
    const vector = await this.embeddings.embedQuery(query);
    const hits = await this.vectors.query(vector, topK, category);

    return hits
      .filter((hit) => hit.score >= this.minScore)
      .map(({ score, metadata }) => ({
        score,
        source: metadata.source,
        title: metadata.title,
        category: metadata.category,
        text: metadata.text,
      }));
  }

  /**
   * The relevance floor is mode-aware.
   *
   * A real embedding model puts a genuinely related pair around 0.5-0.8, so
   * 0.35 filters noise well. The local hash embedding scores far lower even
   * for a good match, because a 600-char chunk spreads its vector over many
   * more features than a one-line query. Using one threshold for both would
   * either admit noise from the cloud model or empty out the local store.
   */
  private get minScore(): number {
    return this.embeddings.mode === 'cloud' ? env.RAG_MIN_SCORE : env.RAG_MIN_SCORE_LOCAL;
  }

  /**
   * Full RAG answer. Retrieves context, hands it to the LLM, and returns the
   * sources alongside so the UI can cite them.
   */
  async answer(params: {
    query: string;
    history?: LlmMessage[];
    category?: string;
    systemPrompt: string;
  }): Promise<RagAnswer> {
    const { query, history = [], category, systemPrompt } = params;
    const contexts = await this.retrieve(query, category);

    const contextBlock =
      contexts.length > 0
        ? contexts
            .map(
              (context, index) =>
                `[${index + 1}] ${context.source} (${context.title}, score ${context.score.toFixed(2)})\n${context.text}`,
            )
            .join('\n\n---\n\n')
        : '(No relevant company document found for this question.)';

    const messages: LlmMessage[] = [
      { role: 'system', content: `${systemPrompt}\n\n## Company documentation\n${contextBlock}` },
      ...history,
      { role: 'user', content: query },
    ];

    // Without an LLM there is nothing to "ground" an answer in, so the raw
    // retrieved chunks are returned instead. That still demonstrates the
    // full RAG path - embed, search, rank - just without the writing step.
    if (this.llm.mode === 'offline') {
      return {
        answer: offlineAnswer(contexts),
        sources: contexts,
        usedContext: contexts.length > 0,
      };
    }

    const result = await this.llm.chat(messages);

    return {
      answer: result.text,
      sources: contexts,
      usedContext: contexts.length > 0,
    };
  }
}

/** Extractive fallback shown when no LLM API key is configured. */
function offlineAnswer(contexts: RetrievedContext[]): string {
  if (contexts.length === 0) {
    return (
      '(offline demo mode, koi LLM key nahi) Is sawaal se related koi document nahi mila. ' +
      'GROQ_API_KEY ya GEMINI_API_KEY set karne par yahan ek grounded jawab aayega.'
    );
  }

  const top = contexts
    .slice(0, 2)
    .map((context, index) => `[${index + 1}] ${context.source} (${context.title})\n${context.text}`)
    .join('\n\n');

  return (
    '(offline demo mode, koi LLM key nahi - yeh document ka raw text hai, jawab nahi)\n\n' +
    `Documentation se relevant section:\n\n${top}`
  );
}

/** Sliding-window chunker with character overlap. */
export function chunkText(text: string, maxChars: number, overlapChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return [normalized];

  const pieces: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    // Prefer breaking on a sentence or word boundary rather than mid-word.
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const sentenceBreak = window.lastIndexOf('. ');
      const wordBreak = window.lastIndexOf(' ');
      const cut = sentenceBreak > maxChars * 0.5 ? sentenceBreak + 1 : wordBreak;
      if (cut > 0) end = start + cut;
    }

    const piece = normalized.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= normalized.length) break;

    start = Math.max(end - overlapChars, start + 1);
  }

  return pieces;
}
