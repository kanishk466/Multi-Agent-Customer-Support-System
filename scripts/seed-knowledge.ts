/**
 * Standalone knowledge ingest.
 *
 *   npm run seed
 *
 * The server already ingests on boot - run this after editing files in
 * knowledge/ when you want to re-index without restarting.
 *
 * It builds the services by hand instead of through Nest DI, so the script
 * stays a single file with no bootstrap ceremony.
 */
import { initQdrant, qdrantAvailable } from '../src/config/qdrant';
import { EmbeddingsService } from '../src/knowledge/embeddings.service';
import { VectorService } from '../src/knowledge/vector.service';
import { RagService } from '../src/knowledge/rag.service';
import { LlmService } from '../src/llm/llm.service';
import { logger } from '../src/common/logger';

async function main(): Promise<void> {
  const vectors = new VectorService();
  await initQdrant();

  if (qdrantAvailable()) {
    // VectorService.onModuleInit also calls initQdrant(), but calling it
    // again is cheap and keeps this script independent of that detail.
    await vectors.onModuleInit();
  }

  const rag = new RagService(new EmbeddingsService(), vectors, new LlmService());

  const chunks = await rag.ingest();
  const total = await vectors.count();

  logger.info(`Ingested this run: ${chunks} chunks`);
  logger.info(`Total in ${vectors.mode} store: ${total} chunks`);

  // A quick retrieval smoke check so a broken embedding setup fails loudly.
  const hits = await rag.retrieve('refund policy kitne din mein milta hai', 'billing', 3);
  logger.info(`Sample retrieval -> ${hits.length} hits: ${hits.map((h) => `${h.source}(${h.score.toFixed(2)})`).join(', ') || 'none'}`);
}

main().catch((err) => {
  logger.error(`Seed failed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
