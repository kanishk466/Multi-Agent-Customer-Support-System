import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from './env';
import { logger } from '../common/logger';

/**
 * Qdrant = "knowledge" (company docs as vectors).
 *
 * Optional: without a reachable Qdrant the RAG layer falls back to an
 * in-memory cosine store seeded from the same markdown files.
 */
let client: QdrantClient | null = null;
let available = false;

export async function initQdrant(): Promise<QdrantClient | null> {
  client = new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    checkCompatibility: false,
  });

  try {
    // getVersion() is not exposed by this client version - listing
    // collections is the cheapest authenticated round-trip available.
    await client.getCollections();
    available = true;
    logger.info(`Qdrant connected (${env.QDRANT_URL})`);
    return client;
  } catch (err) {
    logger.warn(`Qdrant unavailable (${(err as Error).message}) - vector store: in-memory`);
    available = false;
    client = null;
    return null;
  }
}

export function qdrant(): QdrantClient {
  if (!available || !client) {
    throw new Error('Qdrant is not connected');
  }
  return client;
}

export function qdrantAvailable(): boolean {
  return available && client !== null;
}
