import { createHash } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { env } from '../config/env';
import { logger } from '../common/logger';
import { qdrant, qdrantAvailable, initQdrant } from '../config/qdrant';
import { cosineSimilarity } from './embeddings.service';

/**
 * Declared as a `type` rather than an `interface` on purpose: Qdrant's
 * `payload` field is `Record<string, unknown>`, and only type aliases are
 * assignable to an index-signature type.
 */
export type ChunkMetadata = {
  chunkId: string;
  documentId: string;
  source: string;
  title: string;
  category: string;
  chunkIndex: number;
  text: string;
};

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
}

export interface ScoredChunk {
  score: number;
  metadata: ChunkMetadata;
}

/**
 * Vector store abstraction.
 *
 * Qdrant when it is reachable, an in-memory cosine store otherwise. Both
 * implement the same interface, so RAG code never branches on availability.
 */
@Injectable()
export class VectorService implements OnModuleInit {
  private memory = new Map<string, VectorRecord>();
  private store: 'qdrant' | 'memory' = 'memory';

  async onModuleInit(): Promise<void> {
    await initQdrant();
    if (qdrantAvailable()) {
      this.store = 'qdrant';
      await this.ensureCollection();
    } else {
      logger.warn('Vector store: in-memory (RAG still works, data lost on restart)');
    }
  }

  get mode(): 'qdrant' | 'memory' {
    return this.store;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    if (this.store === 'qdrant') {
      const client = qdrant();
      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        await client.upsert(env.QDRANT_COLLECTION, {
          wait: true,
          points: records.slice(i, i + batchSize).map((record) => ({
            // Qdrant only accepts an unsigned integer or a UUID as a point
            // id - a readable string like "billing-policy-0-0" is a 400.
            // The readable id stays in the payload for debugging.
            id: toPointId(record.id),
            vector: record.values,
            payload: record.metadata,
          })),
        });
      }
      return;
    }

    for (const record of records) this.memory.set(record.id, record);
  }

  async query(vector: number[], topK: number, category?: string): Promise<ScoredChunk[]> {
    if (this.store === 'qdrant') {
      const client = qdrant();
      // v1.19 replaced the legacy `search` call with the universal `query`
      // API - `{ nearest: vector }` is the plain vector-search form of it.
      const hits = await client.query(env.QDRANT_COLLECTION, {
        query: { nearest: vector },
        limit: topK,
        with_payload: true,
        ...(category
          ? { filter: { must: [{ key: 'category', match: { value: category } }] } }
          : {}),
      });

      return hits.points.map((point) => ({
        score: point.score ?? 0,
        metadata: point.payload as unknown as ChunkMetadata,
      }));
    }

    const scored: ScoredChunk[] = [];
    for (const record of this.memory.values()) {
      if (category && record.metadata.category !== category) continue;
      scored.push({ score: cosineSimilarity(vector, record.values), metadata: record.metadata });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** Removes every chunk belonging to a document (used before re-ingesting). */
  async deleteByDocument(documentId: string): Promise<void> {
    if (this.store === 'qdrant') {
      await qdrant().delete(env.QDRANT_COLLECTION, {
        filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
      });
      return;
    }
    for (const [id, record] of this.memory) {
      if (record.metadata.documentId === documentId) this.memory.delete(id);
    }
  }

  async count(): Promise<number> {
    if (this.store === 'qdrant') {
      const result = await qdrant().count(env.QDRANT_COLLECTION, { exact: true });
      return result.count ?? 0;
    }
    return this.memory.size;
  }

  /**
   * Creates the collection and the two payload indexes that filtering needs.
   *
   * Qdrant refuses any filter on an unindexed payload key with
   * "Index required but not found" - so `category` filtering and
   * `deleteByDocument` both fail without these.
   */
  private async ensureCollection(): Promise<void> {
    const client = qdrant();
    const exists = (await client.getCollections()).collections.some(
      (collection) => collection.name === env.QDRANT_COLLECTION,
    );

    if (!exists) {
      await client.createCollection(env.QDRANT_COLLECTION, {
        vectors: { size: env.EMBEDDING_DIMS, distance: 'Cosine' },
      });
      logger.info(
        `Qdrant collection "${env.QDRANT_COLLECTION}" created (${env.EMBEDDING_DIMS} dims)`,
      );
    }

    for (const field of ['documentId', 'category'] as const) {
      try {
        await client.createPayloadIndex(env.QDRANT_COLLECTION, {
          field_name: field,
          field_schema: 'keyword',
        });
      } catch (err) {
        // Already indexed (409) is the normal case on every boot after the
        // first - anything else is worth surfacing.
        if (!/exist|409/i.test((err as Error).message)) throw err;
      }
    }
  }
}

/**
 * Deterministic UUID for a readable chunk id.
 *
 * Deterministic rather than randomUUID() so re-ingesting the same chunk
 * overwrites its old point instead of leaving a duplicate behind.
 *
 * Build the bytes first, then slice the hex - writing `0x80 | x` with
 * toString() produces decimal ("188"), which makes a 5-character group and
 * a UUID Qdrant rejects.
 */
export function toPointId(value: string): string {
  const bytes = Buffer.from(
    createHash('sha1').update(`support-kb:${value}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // RFC 4122 version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex'); // always 32 chars
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
