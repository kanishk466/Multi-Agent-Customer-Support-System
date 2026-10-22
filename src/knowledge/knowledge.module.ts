import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { EmbeddingsService } from './embeddings.service';
import { VectorService } from './vector.service';
import { RagService } from './rag.service';

/** Knowledge base: embeddings + vector store + retrieval. */
@Module({
  imports: [LlmModule],
  providers: [EmbeddingsService, VectorService, RagService],
  exports: [EmbeddingsService, VectorService, RagService],
})
export class KnowledgeModule {}
